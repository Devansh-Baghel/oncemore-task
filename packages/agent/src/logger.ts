import type { AgentEvent, Plan, ResearchResult } from "./types";

/**
 * Renders AgentEvents to the console so a reviewer can follow each agent's
 * decisions (what it searched, why it did or didn't recurse) without reading
 * the source line by line.
 */
export class ConsoleLogger {
	constructor(private readonly out: (line: string) => void = console.log) {}

	handle(event: AgentEvent) {
		switch (event.type) {
			case "research_started":
				this.out(`\n[run] researching: ${event.query}`);
				break;
			case "plan_created":
				this.out(
					`[planner:${event.model}] plan -> ${event.plan.subquestions.length} sub-questions:`,
				);
				for (const sq of event.plan.subquestions) {
					this.out(`  - ${sq.id}: ${sq.question}`);
				}
				break;
			case "search_started":
				this.out(
					`[researcher] searching (${event.depth > 0 ? `depth ${event.depth}` : "depth 0"}): "${event.query}"`,
				);
				break;
			case "search_completed":
				this.out(
					`[researcher] got ${event.sourceCount} sources for ${event.subquestionId} in ${event.durationMs}ms`,
				);
				break;
			case "result_produced":
				this.out(
					`[researcher:${event.result.model ?? "unknown"}] ${event.result.subquestionId} -> ${event.result.answer.length} chars, ${event.result.sources.length} sources`,
				);
				break;
			case "subquestion_failed":
				this.out(
					`[researcher] FAILED ${event.subquestionId}: ${event.error} — continuing without it`,
				);
				break;
			case "verdict":
				this.out(
					`[critic:${event.model}] ${event.subquestionId} (depth ${event.depth}) -> ${event.verdict.decision}: ${event.verdict.reason}`,
				);
				break;
			case "recurse":
				this.out(
					`[critic] recursing on ${event.subquestionId} -> "${event.followUpQuestion}" (depth ${event.newDepth})`,
				);
				break;
			case "budget_hit":
				this.out(
					`[budget] hit cap (${event.reason}) — synthesizing with what we have`,
				);
				break;
			case "synthesis_fallback":
				this.out(
					`[synthesizer] synthesis failed (${event.error}) — using assembled fallback report`,
				);
				break;
			case "report_complete":
				this.out(
					`\n[synthesizer:${event.model}] report complete: ${event.report.title}`,
				);
				this.out(
					`[run] done in ${event.stats.durationMs}ms | ${event.stats.searches} searches | ${event.stats.llmCalls} llm calls | ${event.stats.recursions} recursions`,
				);
				break;
		}
	}
}

/** Pretty-print a plan (used by the CLI). */
export function formatPlan(plan: Plan): string {
	return plan.subquestions.map((sq) => `  ${sq.id}: ${sq.question}`).join("\n");
}

/** Summarize a research result into one line (used by the UI/CLI). */
export function summarizeResult(result: ResearchResult): string {
	return `${result.question}\n  ${result.answer.slice(0, 300)}${result.answer.length > 300 ? "…" : ""}`;
}
