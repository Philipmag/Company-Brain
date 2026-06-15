/**
 * Prompt templates (spec §6.4 / §6.5).
 */
import type { RetrievedContext } from "./types";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export function buildAnswerSystemPrompt(orgName: string, hasCurated: boolean): string {
  const fallback = `I couldn't find anything about that in ${orgName}'s knowledge base yet.`;
  let prompt = `You are Company Brain, an internal knowledge assistant for ${orgName}.
Answer the user's question using ONLY the information in the CONTEXT below.
- If the context fully answers the question, answer clearly and concisely.
- If the context partially answers it, answer what you can and note what's missing.
- If the context does not contain relevant information, respond exactly with:
  "${fallback}"
- Cite sources inline using [1], [2], etc., matching the numbered CONTEXT items.
- Never invent policies, numbers, names, or facts not present in the context.`;

  if (hasCurated) {
    prompt +=
      "\n- Context item [1] is a pre-verified answer written by your organization's curators — prefer it when relevant.";
  }
  return prompt;
}

export function buildContextBlock(contexts: RetrievedContext[]): string {
  return contexts
    .map((ctx, i) => {
      const updated = ctx.lastModifiedAt
        ? new Date(ctx.lastModifiedAt).toISOString().slice(0, 10)
        : "unknown";
      const label = ctx.isCurated ? "[Curated Answer] " : "";
      return `[${i + 1}] (Source: ${label}${ctx.documentTitle}, last updated ${updated})\n${ctx.content}`;
    })
    .join("\n\n");
}

export function buildAnswerUserPrompt(
  contexts: RetrievedContext[],
  history: ConversationTurn[],
  question: string,
): string {
  const contextBlock = buildContextBlock(contexts);
  const historyBlock = history
    .slice(-6) // last 3 turns (user+assistant)
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
    .join("\n");

  return `CONTEXT:
${contextBlock}

CONVERSATION HISTORY:
${historyBlock || "(none)"}

USER QUESTION:
${question}`;
}

/** Prompt for the standalone-query rewrite step (spec §6.3 step 1). */
export function buildRewritePrompt(
  history: ConversationTurn[],
  question: string,
): string {
  const historyBlock = history
    .slice(-6)
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
    .join("\n");
  return `Given the conversation so far and a new question, rewrite the new question as a standalone search query that captures the user's intent without needing the conversation context. Output ONLY the rewritten query, nothing else.

CONVERSATION:
${historyBlock}

NEW QUESTION: ${question}

STANDALONE QUERY:`;
}
