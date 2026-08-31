# oncemore — Mini Recursive Research Agent

A small multi-agent research system: give it a question, and a **planner → (parallel) researchers → critic → synthesizer** pipeline researches sub-questions, recurses one level deeper where answers are weak (up to a hard cap), and returns a short cited report.

Built for the [Paid Trial Task](docs/Paid_Trial_Task_Recursive_Research_Agent%20(1).md): a scoped-down recursive research agent with at least 3 distinct agent roles, structured JSON hand-offs, an enforced budget, and decision logging.

## Quick start

```bash
# 1. Install deps (Bun)
bun install

# 2. Set API keys in apps/server/.env
cp apps/server/.env.example apps/server/.env
#   - AWS_BEDROCK_API_KEY (AWS Bedrock us-east-1)
#   - AWS_BEDROCK_REGION=us-east-1
#   - EXA_API_KEY (free tier: https://dashboard.exa.ai)
#   - CORS_ORIGIN=http://localhost:3001 (default)

# 3a. CLI
bun run agent -- "Why is the sky blue?" --max-depth 2 --max-searches 10

# 3b. Web UI (streams agent decisions live)
bun run dev
# → web app:  http://localhost:3001
# → API:      http://localhost:3000 (POST /api/research streams SSE)
```

Requires **Node 22+** and **Bun 1.2+**.

## How it works

```
user query
   │
   ▼
[Planner]  ──►  Plan { subquestions: [{id, question, depth:0}] }
   │
   ▼
[Researcher ×N — PARALLEL]  ──►  ResearchResult { answer, sources: [{url,title,quotes}] }
   │
   ▼
[Critic]  ──►  Verdict { decision: accept | recurse | fail, reason, followUpQuestion? }
   │
   ├── accept ───────────────► synthesis
   ├── recurse (depth < cap) ► research the follow-up one level deeper
   └── cap hit / fail        ► synthesize with what we have (graceful stop)
   │
   ▼
[Synthesizer]  ──►  FinalReport { title, summary, sections, citations }
```

- **Roles** live in `packages/agent/src/` — `planner.ts`, `researcher.ts`, `critic.ts`, `synthesizer.ts`. Each is a pure function of structured JSON in → structured JSON out.
- **Orchestrator** (`orchestrator.ts`) owns the recursion loop and enforces the budget.
- **Structured hand-offs** are zod schemas in `types.ts` — no raw strings passed between roles.
- **Budget enforced in code**: `maxDepth`, `maxTotalSearches`, `maxSourcesPerSubquestion`, `parallelism`. Every search goes through a `BudgetTracker`; on cap-hit it emits a `budget_hit` event and synthesizes with what it has rather than crashing.
- **Logging**: the orchestrator emits a single `AgentEvent` stream. The CLI renders it to the console; the web UI streams the same events over SSE. Every decision (what was searched, why it recursed) is traceable.

## Tech choices

| Area | Choice | Why |
|---|---|---|
| LLM | AWS Bedrock via `@ai-sdk/amazon-bedrock` (Vercel AI SDK) | us-east-1, API-key auth |
| Planner / Synthesizer | `us.anthropic.claude-sonnet-4-6` | Strong reasoning for planning and final report |
| Researcher | `zai.glm-4.7` | Fast + reliable for sub-question research |
| Critic | `zai.glm-5` | Strong judgment for accept/recurse decisions |
| Search | Exa REST API | Search + clean content extraction in one call |
| Stack | This monorepo (Next.js web, Express on Bun, shared `packages/agent`) | Reuses the scaffold; `bun run dev` runs everything |

> **Structured output**: every role uses **JSON-instruct** — the prompt demands a JSON object, and the result is parsed + validated with zod, retrying on failure.

## CLI

```bash
bun run agent -- "your question" [--max-depth N] [--max-searches N] [--out file.json]
```

Prints the live agent trace, then the final report. A JSON trace (all events + the report) is written to `traces/<timestamp>.json` (or `--out`).

## Web UI

- **`POST /api/research`** (Express, `apps/server/src/research.ts`) runs the pipeline and streams `AgentEvent`s as SSE `data:` frames, ending with a `done` frame carrying the report + stats.
- **`apps/web`** renders a live timeline (planner sub-questions → parallel searches → critic verdicts → recursion events) and the final report with citations.

## Tests

```bash
cd packages/agent && bun test
```

The orchestrator is tested with a fake LLM (no network, no credits): one test verifies the planner→researcher→critic→recurse→report flow; another verifies the budget cap stops recursion gracefully and still produces a report.

## Project layout

```
packages/agent/src/     # the agent engine (roles + orchestrator + types + logger)
apps/server/src/        # Express API (SSE endpoint) + CLI entry
apps/web/src/           # Next.js streaming UI
```

## Decision Note

Why the architecture is the way it is (alternatives considered and rejected, cost/speed reasoning) lives in [apps/server/DECISION_NOTE.md](apps/server/DECISION_NOTE.md).
