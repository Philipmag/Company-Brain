/**
 * Heading/paragraph/sentence-aware chunker (spec §6.1 step 3).
 * - Target 500 tokens, 75 token overlap (~15%)
 * - Split priority: headings/section breaks > paragraphs > sentences
 * - Tables kept intact as single chunks up to 1500 tokens
 * Uses js-tiktoken (pure JS) so it runs in any Node/edge runtime.
 */
import { getEncoding, type Tiktoken } from "js-tiktoken";
import {
  CHUNK_TARGET_TOKENS,
  CHUNK_OVERLAP_TOKENS,
  TABLE_MAX_TOKENS,
} from "./constants";

let enc: Tiktoken | null = null;
function encoder(): Tiktoken {
  if (!enc) enc = getEncoding("cl100k_base");
  return enc;
}

export function countTokens(text: string): number {
  return encoder().encode(text).length;
}

export interface ChunkResult {
  content: string;
  tokenCount: number;
  chunkIndex: number;
  metadata: { sectionHeading?: string; isTable?: boolean };
}

interface Block {
  text: string;
  heading?: string;
  isTable: boolean;
}

const HEADING_RE = /^(#{1,6}\s+.+|[A-Z][A-Z0-9 \-]{3,}|.+\n[=-]{3,})$/;

function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^#{1,6}\s+/.test(t)) return true;
  // ALL CAPS short line
  if (t.length <= 80 && /^[A-Z0-9][A-Z0-9 \-:&/]+$/.test(t) && t.split(" ").length <= 12) {
    return true;
  }
  return false;
}

function isTableLine(line: string): boolean {
  const t = line.trim();
  // Markdown table rows or tab-separated rows
  return (t.startsWith("|") && t.endsWith("|")) || /\t.*\t/.test(t);
}

/** Break raw text into semantic blocks (paragraphs, headings, tables). */
function toBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let currentHeading: string | undefined;
  let buffer: string[] = [];
  let bufferIsTable = false;

  const flush = () => {
    const joined = buffer.join("\n").trim();
    if (joined) {
      blocks.push({ text: joined, heading: currentHeading, isTable: bufferIsTable });
    }
    buffer = [];
    bufferIsTable = false;
  };

  for (const line of lines) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (looksLikeHeading(line)) {
      flush();
      currentHeading = line.replace(/^#{1,6}\s+/, "").trim();
      continue;
    }
    const tableLine = isTableLine(line);
    if (tableLine !== bufferIsTable && buffer.length > 0) {
      flush();
    }
    bufferIsTable = tableLine;
    buffer.push(line);
  }
  flush();
  return blocks;
}

function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

/**
 * Chunk text into ~CHUNK_TARGET_TOKENS pieces with CHUNK_OVERLAP_TOKENS overlap.
 */
export function chunkText(text: string): ChunkResult[] {
  const blocks = toBlocks(text);
  const chunks: ChunkResult[] = [];
  let index = 0;

  const push = (content: string, heading?: string, isTable = false) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    chunks.push({
      content: trimmed,
      tokenCount: countTokens(trimmed),
      chunkIndex: index++,
      metadata: { ...(heading ? { sectionHeading: heading } : {}), ...(isTable ? { isTable: true } : {}) },
    });
  };

  let acc = "";
  let accHeading: string | undefined;

  const flushAcc = () => {
    if (acc.trim()) push(acc, accHeading);
    acc = "";
  };

  for (const block of blocks) {
    // Tables kept intact up to TABLE_MAX_TOKENS.
    if (block.isTable) {
      flushAcc();
      if (countTokens(block.text) <= TABLE_MAX_TOKENS) {
        push(block.text, block.heading, true);
      } else {
        // Oversized table: fall back to row-wise splitting.
        for (const piece of packBySentences(block.text.split("\n"), TABLE_MAX_TOKENS)) {
          push(piece, block.heading, true);
        }
      }
      continue;
    }

    const blockTokens = countTokens(block.text);
    const accTokens = acc ? countTokens(acc) : 0;

    if (accTokens + blockTokens <= CHUNK_TARGET_TOKENS) {
      acc = acc ? `${acc}\n\n${block.text}` : block.text;
      accHeading = accHeading ?? block.heading;
      continue;
    }

    // Block alone fits a chunk: flush accumulator, then place block (with overlap).
    flushAcc();
    accHeading = block.heading;

    if (blockTokens <= CHUNK_TARGET_TOKENS) {
      acc = block.text;
    } else {
      // Oversized paragraph: split by sentences with overlap.
      for (const piece of packBySentences(splitSentences(block.text), CHUNK_TARGET_TOKENS, CHUNK_OVERLAP_TOKENS)) {
        push(piece, block.heading);
      }
      acc = "";
    }
  }
  flushAcc();

  return chunks;
}

/** Pack a list of units (sentences or rows) into <= maxTokens pieces with overlap. */
function packBySentences(units: string[], maxTokens: number, overlapTokens = 0): string[] {
  const pieces: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const unit of units) {
    const t = countTokens(unit);
    if (currentTokens + t > maxTokens && current.length > 0) {
      pieces.push(current.join(" ").trim());
      if (overlapTokens > 0) {
        // Keep trailing units up to overlapTokens for context continuity.
        const overlap: string[] = [];
        let ot = 0;
        for (let i = current.length - 1; i >= 0 && ot < overlapTokens; i--) {
          overlap.unshift(current[i]!);
          ot += countTokens(current[i]!);
        }
        current = overlap;
        currentTokens = ot;
      } else {
        current = [];
        currentTokens = 0;
      }
    }
    current.push(unit);
    currentTokens += t;
  }
  if (current.length > 0) pieces.push(current.join(" ").trim());
  return pieces.filter(Boolean);
}
