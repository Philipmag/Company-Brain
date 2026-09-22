"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const EXAMPLE_QUESTIONS = [
  "What's our refund policy?",
  "How many vacation days do I get?",
  "Who do I contact for IT support?",
  "What are our brand colors?",
];

interface Source {
  index: number;
  documentId: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  isCurated?: boolean;
}

interface UIMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  feedback?: "up" | "down" | null;
  streaming?: boolean;
}

interface ConversationListItem {
  id: string;
  title: string | null;
  created_at: string;
}

export function ChatClient({
  orgName,
  userRole,
  displayName,
}: {
  orgName: string;
  userRole: string;
  displayName: string;
}) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await apiFetch<{ conversations: ConversationListItem[] }>(
        "/api/conversations",
      );
      setConversations(res.conversations);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function openConversation(id: string) {
    setConversationId(id);
    const res = await apiFetch<{
      messages: Array<{
        id: string;
        role: "user" | "assistant";
        content: string;
        cited_document_ids: string[] | null;
        feedback: "up" | "down" | null;
      }>;
      documents: Array<{ id: string; title: string | null; source_type: string; source_url: string | null }>;
    }>(`/api/conversations/${id}`);
    const docMap = new Map(res.documents.map((d) => [d.id, d]));
    setMessages(
      res.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        feedback: m.feedback,
        sources: (m.cited_document_ids ?? []).map((did, i) => {
          const d = docMap.get(did);
          return {
            index: i + 1,
            documentId: did,
            title: d?.title ?? "Source",
            sourceType: d?.source_type ?? "upload",
            sourceUrl: d?.source_url ?? null,
          };
        }),
      })),
    );
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
  }

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    setInput("");
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "", streaming: true },
    ]);

    try {
      const res = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
      });

      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const line = evt.replace(/^data: /, "").trim();
          if (!line) continue;
          handleEvent(JSON.parse(line));
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          last.content = err instanceof Error ? err.message : "Something went wrong.";
          last.streaming = false;
        }
        return next;
      });
    } finally {
      setStreaming(false);
      void loadConversations();
    }
  }

  function handleEvent(evt: Record<string, unknown>) {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (!last || last.role !== "assistant") return prev;
      switch (evt.type) {
        case "meta":
          if (typeof evt.conversationId === "string") setConversationId(evt.conversationId);
          break;
        case "sources":
          last.sources = evt.sources as Source[];
          break;
        case "delta":
          last.content += String(evt.text ?? "");
          break;
        case "done":
          last.streaming = false;
          if (typeof evt.messageId === "string") last.id = evt.messageId;
          break;
        case "error":
          last.content = String(evt.message ?? "Something went wrong.");
          last.streaming = false;
          break;
      }
      return next;
    });
  }

  async function vote(messageId: string | undefined, feedback: "up" | "down") {
    if (!messageId) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, feedback } : m)),
    );
    try {
      await apiFetch(`/api/messages/${messageId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ feedback }),
      });
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r bg-white">
        <div className="flex items-center justify-between p-4">
          <span className="font-semibold">{orgName}</span>
        </div>
        <div className="px-3">
          <Button className="w-full" onClick={newChat}>
            + New chat
          </Button>
        </div>
        <nav className="mt-4 flex-1 space-y-1 overflow-auto px-2">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={`block w-full truncate rounded px-3 py-2 text-left text-sm hover:bg-gray-100 ${
                c.id === conversationId ? "bg-gray-100 font-medium" : ""
              }`}
            >
              {c.title ?? "Untitled"}
            </button>
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-gray-500">
          <div className="mb-1 truncate">{displayName}</div>
          {(userRole === "admin" || userRole === "curator") && (
            <Link href="/admin" className="text-brand hover:underline">
              Admin dashboard
            </Link>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-1 flex-col">
        <div className="flex-1 overflow-auto p-6">
          {messages.length === 0 ? (
            <div className="mx-auto mt-20 max-w-xl text-center">
              <h2 className="mb-2 text-xl font-semibold">
                Ask {orgName}&apos;s knowledge base
              </h2>
              <p className="mb-6 text-gray-500">
                Get instant, cited answers from your connected sources.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {EXAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="rounded-lg border bg-white p-3 text-left text-sm hover:border-brand"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6">
              {messages.map((m, i) => (
                <MessageBubble key={m.id ?? i} message={m} onVote={vote} />
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="border-t bg-white p-4">
          <form
            className="mx-auto flex max-w-3xl items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <Button type="submit" disabled={streaming || !input.trim()}>
              {streaming ? "…" : "Send"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}

function MessageBubble({
  message,
  onVote,
}: {
  message: UIMessage;
  onVote: (id: string | undefined, f: "up" | "down") => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-brand px-4 py-2 text-brand-fg">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        <div className="whitespace-pre-wrap rounded-2xl bg-white px-4 py-3 shadow-sm">
          {message.content || (message.streaming ? "…" : "")}
        </div>
        {message.sources && message.sources.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.sources.map((s) => (
              <SourcePill key={`${s.documentId}-${s.index}`} source={s} />
            ))}
          </div>
        )}
        {!message.streaming && message.content && (
          <div className="flex gap-2">
            <button
              className={`text-sm ${message.feedback === "up" ? "opacity-100" : "opacity-40 hover:opacity-100"}`}
              onClick={() => onVote(message.id, "up")}
              aria-label="Helpful"
            >
              👍
            </button>
            <button
              className={`text-sm ${message.feedback === "down" ? "opacity-100" : "opacity-40 hover:opacity-100"}`}
              onClick={() => onVote(message.id, "down")}
              aria-label="Not helpful"
            >
              👎
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SourcePill({ source }: { source: Source }) {
  const icon =
    source.sourceType === "google_drive"
      ? "📄"
      : source.sourceType === "slack"
        ? "💬"
        : source.sourceType === "curated"
          ? "⭐"
          : "📎";
  const content = (
    <span className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-xs hover:border-brand">
      <span>{icon}</span>
      <span className="max-w-[160px] truncate">
        [{source.index}] {source.title}
      </span>
      {source.isCurated && <Badge variant="success">curated</Badge>}
    </span>
  );
  return source.sourceUrl ? (
    <a href={source.sourceUrl} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    content
  );
}
