/**
 * Anthropic Claude wrappers (spec §6.3 / §6.4).
 * - Sonnet for answer generation (streamed)
 * - Haiku for query rewriting
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";
import { ANSWER_MODEL, REWRITE_MODEL } from "./constants.js";
import {
  buildAnswerSystemPrompt,
  buildAnswerUserPrompt,
  buildRewritePrompt,
  type ConversationTurn,
} from "./prompts.js";
import type { RetrievedContext } from "./types.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

/** Query rewrite using Claude Haiku. Returns the standalone query. */
export async function rewriteQuery(
  history: ConversationTurn[],
  question: string,
): Promise<string> {
  const res = await getClient().messages.create({
    model: REWRITE_MODEL,
    max_tokens: 256,
    messages: [{ role: "user", content: buildRewritePrompt(history, question) }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text || question;
}

export interface GenerateAnswerInput {
  orgName: string;
  contexts: RetrievedContext[];
  history: ConversationTurn[];
  question: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Stream an answer from Claude Sonnet. Yields text deltas; resolves usage via
 * the returned `usage` promise once the stream finishes.
 */
export async function* streamAnswer(
  input: GenerateAnswerInput,
  onUsage?: (usage: TokenUsage) => void,
): AsyncGenerator<string, void, unknown> {
  const hasCurated = input.contexts.some((c) => c.isCurated);
  const system = buildAnswerSystemPrompt(input.orgName, hasCurated);
  const userPrompt = buildAnswerUserPrompt(
    input.contexts,
    input.history,
    input.question,
  );

  const stream = getClient().messages.stream({
    model: ANSWER_MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }

  const final = await stream.finalMessage();
  if (onUsage) {
    onUsage({
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
    });
  }
}

/** Non-streaming variant (used by the Slack handler). */
export async function generateAnswer(
  input: GenerateAnswerInput,
): Promise<{ text: string; usage: TokenUsage }> {
  let text = "";
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  for await (const delta of streamAnswer(input, (u) => (usage = u))) {
    text += delta;
  }
  return { text, usage };
}
