# Decision Note — Mini Recursive Research Agent

This note covers the choices behind the architecture, per the trial-task brief. Read it alongside `README.md`.

## Architecture

A **multi-agent pipeline with a shared orchestrator**:

```
Planner → (Researcher ×N in parallel) → Critic (per answer) → [recurse?] → Synthesizer
```

- **Planner** decomposes the user query into 3–5 independent, web-searchable sub-questions.
- **Researchers** run **in parallel** (one per sub-question): Exa search + content extraction, then a concise cited answer.
- **Critic** judges each answer as `accept` / `recurse` / `fail`. On `recurse` it returns a *new, more specific follow-up question*, which the orchestrator researches one level deeper — but only if the depth cap hasn't been hit.
- **Synthesizer** merges the accepted answers into a short cited report.

**Why this shape:** each role is a pure function of structured JSON in → structured JSON out, and the orchestrator owns the loop. Recursion, budgets, and logging all live in one place, so the system stays small but extends cleanly — adding a role or swapping a search provider means adding a file, not reworking the loop. This is also what the task asked for: "at least 3 distinct agent roles with a clear handoff" and "structured data hand-off, not just raw strings."

## Alternatives considered and rejected

- **One monolithic script / single agent loop.** Rejected: it would have satisfied "working code" but not the *orchestration* criterion, and would be harder to extend or debug.
- **Per-sub-question recursive DFS (like GPT-Researcher / LangChain deep agents).** Rejected in favor of a **level-by-level breadth-first recursion**: all depth-0 sub-questions research in parallel (the widest, cheapest fan-out), and only the answers the critic flags recurse. This keeps end-to-end latency low and total searches proportional to actual need — we don't recurse unconditionally.
- **A framework (LangGraph / CrewAI / etc.).** Rejected: for a system this size, framework overhead outweighs the benefit, and the task explicitly allows raw function calls. The role separation comes from code structure, not a library.
- **Tavily/SerpAPI/scraping for search.** Chosen **Exa** because it returns clean, LLM-ready content (highlights + text) in the same call as search — no separate fetch/parse step, which keeps latency and cost down.
- **Claude/OpenAI for the LLM.** Chosen **NVIDIA NIM** (free credits) with the **Vercel AI SDK** `@ai-sdk/openai-compatible` provider. Models are swappable via `config.ts` — the plan called for "swappable via config," and the `Llm` interface makes tests provider-free.

## Cost and speed reasoning

- **Parallelism wins where it's cheapest.** The widest fan-out happens at depth 0 (5 searches in parallel). NIM's free tier is ~40 RPM and Exa's free tier covers ~$10 of credits, so 10–20 total searches is well within budget. The `parallelism` config caps concurrency if needed.
- **Recursion is gated by the critic, not unconditional.** A shallow, well-covered query does 5 searches; only genuinely weak answers cost a second level. This is the main cost control.
- **Hard caps enforced in code** (`maxDepth: 2`, `maxTotalSearches: 10`, per-level sub-question and source caps): on cap-hit the orchestrator emits a `budget_hit` event and synthesizes with what it has — it stops gracefully instead of blowing the budget.
- **Model choice:** `openai/gpt-oss-20b` for planner/researcher/critic (fast, reliable JSON output), `openai/gpt-oss-120b` for synthesis (stronger, once, at the end). Cheap role calls + one expensive call at the end is the right cost curve.
- **Search text is trimmed** to a per-source char budget before it reaches the LLM, keeping context small and costs linear.

## How to verify

1. `bun run check-types` — passes across all packages.
2. `cd packages/agent && bun test` — orchestrator tests (fake LLM, no network): recursion flow + graceful budget-stop.
3. `bun run agent -- "Why is the sky blue?" --max-depth 1 --max-searches 4` — planner → 4 parallel searches → 4 critic verdicts → cited report, in ~75s.
4. `bun run dev` → http://localhost:3001 — live streaming trace + report in the browser.
