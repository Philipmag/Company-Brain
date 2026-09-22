# Company Brain — Code Walkthrough

A guide to defending this codebase in a technical interview. Complements
`ARCHITECTURE.md` (which covers layout); this covers **flow, decisions and
trade-offs**.

---

## 1. What it is, in one sentence

A permission-aware RAG assistant: it ingests an organisation's Google Drive and
Slack content, and answers questions in natural language with citations — while
guaranteeing a user can only ever retrieve content they were already allowed to
see.

That last clause is the hard part, and it's where the interesting engineering is.

---

## 2. The request flow (follow this path when asked "how does it work?")

```
User question
  │
  ├─ apps/web/src/app/api/chat/message/route.ts
  │    requireSession()  →  { user, org }          ← server-derived, never client input
  │
  ├─ packages/shared/src/retrieval.ts :: retrieveContext()
  │    embedText(query)                            → query vector
  │    Promise.all([
  │      rpc match_chunks      (vector / pgvector)
  │      rpc keyword_chunks    (full-text)
  │      rpc curated_answers   (human-verified Q→A pairs)
  │    ])                                          ← all three take org_id + groups
  │
  ├─ rerank()                                      → RERANK_TOP_N above threshold
  │
  ├─ llm.ts                                        → answer + citations (SSE stream)
  │
  └─ below threshold? → knowledge_gap recorded instead of hallucinating
```

**The detail worth volunteering:** retrieval is *hybrid*. Vector search alone
misses exact identifiers (ticket numbers, product SKUs, policy codes); keyword
search alone misses paraphrase. Running both and reranking gets the recall of
one with the precision of the other. Curated answers are checked in parallel so
a human-verified response can outrank anything statistical.

---

## 3. The permission model — two independent layers

This is the part most candidates get wrong, and this codebase gets right.

**Layer 1 — RLS, for the user-scoped client.**
`supabase/migrations/0003_rls.sql` defines **21 policies across 10 tables**.
Every row is scoped by `org_id = current_org_id()`; documents and chunks
additionally require `visibility_group_ids && current_visibility_groups()`.
Writes are role-gated to admin/curator.

**Layer 2 — explicit filters, for the service-role client.**
The worker and retrieval path use the service-role key, which **bypasses RLS by
design**. So the SQL RPCs (`match_chunks`, `keyword_chunks`, `curated_answers`)
take `p_org_id` and `p_groups` as required parameters and filter inside the
query. The same rule is enforced twice, by two different mechanisms.

**Why two layers?** Because RLS cannot protect a path that legitimately needs to
bypass it. Rather than granting the worker broad access and hoping, the
permission predicate is re-stated as an explicit filter the RPC cannot run
without.

**The question you will be asked:** *"Could a user widen their own access?"*
Answer: no — `visibilityGroupIds` is read from the session row server-side
(`route.ts:125` passes `user.visibility_group_ids`, sourced from
`requireSession()`), never from the request body. A tampered client payload
changes nothing.

---

## 4. Security specifics worth naming

| Concern | Implementation | Where |
|---|---|---|
| Slack request forgery | HMAC-SHA256 over `v0:timestamp:body` | `lib/connectors/slack.ts` |
| Replay attacks | 5-minute timestamp window | same |
| Timing attacks | `timingSafeEqual`, length-checked first | same |
| OAuth token storage | AES-256-GCM, random IV per record | `shared/src/encryption.ts` |
| Session identity | Supabase `auth.getUser()` server-side | `lib/auth.ts` |
| Role escalation | Roles read from `users` table, never from client | `lib/auth.ts` |

All three Slack routes (`/commands/ask`, `/events`, `/interactivity`) verify
signatures before doing any work.

---

## 5. Design decisions you should be able to justify

**Monorepo with a `shared` package.** The worker and the web app must chunk,
embed and retrieve *identically* — if ingestion and query-time embedding drift,
retrieval silently degrades. Sharing the code makes drift impossible rather than
merely unlikely.

**BullMQ worker instead of serverless ingestion.** Document ingestion is
long-running and rate-limited by upstream APIs. Serverless timeouts make that
fragile; a queue gives retries, backoff and visibility.

**pgvector inside Postgres rather than a dedicated vector DB.** Keeps embeddings
in the same transactional store as permissions — so a permission change and a
retrieval filter can never be out of sync across two systems. The cost is
scaling ceiling; at MVP scale that trade is clearly right.

**Knowledge gaps instead of low-confidence answers.** When top rerank score is
below `RERANK_SCORE_THRESHOLD`, the system records a gap rather than answering.
For an internal knowledge tool, a confident wrong answer is worse than "I don't
know" — and the gap log becomes the content roadmap.

---

## 6. Honest gaps — name these before an interviewer finds them

1. **No automated tests.** 0 test files. The retrieval and permission paths are
   the two things most deserving of them. Highest-value first test: a user in
   group A must never retrieve a chunk scoped to group B.
2. **No CI.** No build/lint/typecheck gate.
3. **Not load-tested.** Hybrid retrieval issues 3 RPCs plus an embed call plus a
   rerank per question; latency under concurrency is unmeasured.
4. **Reranker is a cost/latency hotspot** on every query, with no caching.
5. **No evaluation harness** — no golden question set, so retrieval quality
   changes cannot be measured.

Saying these first reads as engineering maturity. Being caught by them does not.

---

## 7. Before you pin this repo

- [ ] Run it locally end-to-end (`docker-compose up` for Redis, then the app)
- [ ] Trace one question through the flow in §2 with a debugger
- [ ] Read `0003_rls.sql` in full — it is the most likely deep-dive target
- [ ] Add the group-isolation test from §6.1
- [ ] Add a screenshot of the chat UI with citations to the README
