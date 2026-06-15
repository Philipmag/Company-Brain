/**
 * Pluggable DocumentParser interface (spec §11 tech stack).
 * Prefers unstructured.io if UNSTRUCTURED_API_KEY is set; otherwise falls back
 * to pdf-parse (PDF), mammoth (DOCX), and raw text for txt/md/html.
 */
import mammoth from "mammoth";
import { optionalEnv } from "@company-brain/shared";

export interface ParseInput {
  buffer: Buffer;
  mimeType: string | null;
  fileName: string | null;
}

export interface ParseResult {
  text: string;
}

export interface DocumentParser {
  /** Whether this parser can handle the given input. */
  supports(input: ParseInput): boolean;
  parse(input: ParseInput): Promise<ParseResult>;
}

function ext(fileName: string | null): string {
  if (!fileName) return "";
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

function isPdf(input: ParseInput): boolean {
  return input.mimeType === "application/pdf" || ext(input.fileName) === "pdf";
}

function isDocx(input: ParseInput): boolean {
  return (
    input.mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext(input.fileName) === "docx"
  );
}

const PlainTextParser: DocumentParser = {
  supports: () => true,
  async parse(input) {
    let text = input.buffer.toString("utf8");
    // Strip HTML tags if it looks like HTML (e.g. Google Docs HTML export).
    if (/<\/?[a-z][\s\S]*>/i.test(text) && /<html|<body|<p|<div/i.test(text)) {
      text = stripHtml(text);
    }
    return { text };
  },
};

const PdfParser: DocumentParser = {
  supports: isPdf,
  async parse(input) {
    // Dynamic import — pdf-parse pulls in test fixtures at module top-level.
    const mod = await import("pdf-parse");
    const pdf = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string }>;
    const result = await pdf(input.buffer);
    return { text: result.text };
  },
};

const DocxParser: DocumentParser = {
  supports: isDocx,
  async parse(input) {
    const result = await mammoth.extractRawText({ buffer: input.buffer });
    return { text: result.value };
  },
};

const UnstructuredParser: DocumentParser = {
  supports: () => Boolean(optionalEnv("UNSTRUCTURED_API_KEY")),
  async parse(input) {
    const apiKey = optionalEnv("UNSTRUCTURED_API_KEY");
    const apiUrl = optionalEnv(
      "UNSTRUCTURED_API_URL",
      "https://api.unstructured.io/general/v0/general",
    );
    const form = new FormData();
    const blob = new Blob([new Uint8Array(input.buffer)], {
      type: input.mimeType ?? "application/octet-stream",
    });
    form.append("files", blob, input.fileName ?? "document");
    form.append("strategy", "auto");

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "unstructured-api-key": apiKey, accept: "application/json" },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`unstructured.io error ${res.status}: ${await res.text()}`);
    }
    const elements = (await res.json()) as Array<{ text?: string }>;
    const text = elements
      .map((e) => e.text ?? "")
      .filter(Boolean)
      .join("\n\n");
    return { text };
  },
};

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Resolve the best parser for the input. Order: unstructured (if enabled) >
 * type-specific > plain text.
 */
export async function parseDocument(input: ParseInput): Promise<ParseResult> {
  const candidates: DocumentParser[] = [
    UnstructuredParser,
    PdfParser,
    DocxParser,
    PlainTextParser,
  ];
  for (const parser of candidates) {
    if (parser.supports(input)) {
      try {
        return await parser.parse(input);
      } catch (err) {
        // Fall through to the next parser on failure (e.g. unstructured down).
        if (parser === PlainTextParser) throw err;
      }
    }
  }
  return PlainTextParser.parse(input);
}
