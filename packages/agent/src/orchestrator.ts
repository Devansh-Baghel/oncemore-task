import type { AgentConfig } from "./config";
import { judgeResult } from "./critic";
import { type Llm, resolveModel } from "./llm";
import type { ConsoleLogger } from "./logger";
import { planResearch } from "./planner";
import { researchSubquestion } from "./researcher";
import { synthesizeReport } from "./synthesizer";
import type {
	AgentEvent,
	BudgetSpend,
	Plan,
	Report,
	ResearchResult,
	RunStats,
	Subquestion,
	Verdict,
} from "./types";

export interface RunCallbacks {
	onEvent?: (event: AgentEvent) => void;
	logger?: ConsoleLogger;
}

export interface RunInput {
	query: string;
	config?: Partial<AgentConfig>;
	llm?: Llm;
	callbacks?: RunCallbacks;
}

/**
 * Tracks the hard budget for a run (total searches, LLM calls, depth).
 * Enforced in code — every search goes through `spend`; when exhausted it
 * returns false and the orchestrator stops issuing searches gracefully.
 */
export class BudgetTracker {
	searches = 0;
	llmCalls = 0;

	constructor(
		private readonly maxSearches: number,
		private readonly onHit: (reason: "searches") => void,
	) {}

	canSpend(spend: BudgetSpend): boolean {
		if (spend === "search") return this.searches < this.maxSearches;
		return true;
	}

	/** Returns false when the budget is exhausted (and fires the onHit callback). */
	spend(spend: BudgetSpend): boolean {
		if (spend === "search") {
			if (this.searches >= this.maxSearches) {
				this.onHit("searches");
				return false;
			}
			this.searches++;
		} else {
			this.llmCalls++;
		}
		return true;
	}
}

/**
 * Orchestrator: owns the recursion loop. Planner -> parallel researchers ->
 * critic per result -> (recurse one level deeper if verdict says so, up to
 * maxDepth) -> synthesizer. Emits structured events for the CLI and UI.
 */
export async function runResearch(input: RunInput): Promise<{
	report: import("./types").Report;
	stats: RunStats;
	results: ResearchResult[];
	plan: Plan;
}> {
	const { query, config: configPatch, llm: llmLib, callbacks } = input;

	const { agentConfigSchema } = await import("./config");
	const config: AgentConfig = agentConfigSchema.parse(configPatch ?? {});
	const llm: Llm = llmLib ?? (await import("./llm")).createLlm(config);

	const emit = (event: AgentEvent) => {
		callbacks?.logger?.handle(event);
		callbacks?.onEvent?.(event);
	};

	const startedAt = Date.now();
	const stats: RunStats = {
		searches: 0,
		llmCalls: 0,
		recursions: 0,
		durationMs: 0,
	};
	const results: ResearchResult[] = [];

	// Budget: when exhausted, emit ONE budget_hit event and stop issuing searches.
	let budgetHitEmitted = false;
	const budget = new BudgetTracker(config.maxTotalSearches, (reason) => {
		if (budgetHitEmitted) return;
		budgetHitEmitted = true;
		emit({ type: "budget_hit", reason });
	});

	// Pool limits LLM calls through the same counter as searches.
	const spendLlm = () => {
		budget.spend("llm");
		stats.llmCalls++;
	};

	emit({ type: "research_started", query, config });

	// ---- Planner ----
	const plan = await planResearch(query, { llm, config });
	emit({
		type: "plan_created",
		plan,
		model: resolveModel(config, "planner"),
	});

	// ---- Depth-first recursion (with parallel siblings at each depth) ----
	// Returns null when the search budget is exhausted OR the sub-question
	// failed after retries — the run continues with what it has.
	async function researchSubquestionWithBudget(
		sq: Subquestion,
	): Promise<ResearchResult | null> {
		if (!budget.spend("search")) return null;
		stats.searches++;
		emit({
			type: "search_started",
			subquestionId: sq.id,
			query: sq.question,
			depth: sq.depth,
		});
		const t0 = Date.now();
		let result: ResearchResult;
		try {
			result = await researchSubquestion(sq, { llm, config });
		} catch (err) {
			// One bad sub-question must not kill the whole run.
			emit({
				type: "subquestion_failed",
				subquestionId: sq.id,
				question: sq.question,
				depth: sq.depth,
				error: (err as Error).message.slice(0, 300),
			});
			return null;
		}
		budget.spend("llm");
		stats.llmCalls++;
		emit({
			type: "search_completed",
			subquestionId: sq.id,
			depth: sq.depth,
			sourceCount: result.sources.length,
			durationMs: Date.now() - t0,
		});
		emit({ type: "result_produced", result });
		return result;
	}

	async function researchLevel(
		subquestions: Subquestion[],
	): Promise<ResearchResult[]> {
		const sem = semaphore(config.parallelism);
		const settled = await Promise.all(
			subquestions.map((sq) => sem(() => researchSubquestionWithBudget(sq))),
		);
		return settled.filter((r): r is ResearchResult => r !== null);
	}

	async function evaluate(result: ResearchResult): Promise<Verdict> {
		spendLlm();
		return judgeResult(result, { llm, config });
	}

	// Recursion: process depth 0 subquestions in parallel; for each verdict
	// "recurse", spawn one deeper subquestion and merge its result.
	const depth0 = plan.subquestions.filter((sq) => sq.depth === 0);
	const level0 = await researchLevel(depth0);
	results.push(...level0);

	for (const result of level0) {
		let verdict: Verdict;
		try {
			verdict = await evaluate(result);
		} catch (err) {
			// The critic already falls back internally; this is a last resort.
			verdict = {
				decision: "accept",
				reason: `Critic errored (${(err as Error).message.slice(0, 150)}) — accepted by default`,
			};
		}
		emit({
			type: "verdict",
			subquestionId: result.subquestionId,
			depth: result.depth,
			verdict,
			model: resolveModel(config, "critic"),
		});

		if (
			verdict.decision === "recurse" &&
			verdict.followUpQuestion &&
			result.depth < config.maxDepth
		) {
			const deeper: Subquestion = {
				id: `${result.subquestionId}-r`,
				question: verdict.followUpQuestion,
				depth: result.depth + 1,
			};
			emit({
				type: "recurse",
				subquestionId: result.subquestionId,
				followUpQuestion: deeper.question,
				newDepth: deeper.depth,
			});
			stats.recursions++;
			const deeperResult = await researchSubquestionWithBudget(deeper);
			if (deeperResult) results.push(deeperResult);
		}
	}

	// ---- Synthesizer ----
	// If synthesis fails (or there are no results at all), degrade to a
	// deterministic report assembled from whatever research succeeded.
	let report: Report;
	const synthesizerModel = resolveModel(config, "synthesizer");
	try {
		report = await synthesizeReport(query, results, { llm, config });
	} catch (err) {
		emit({
			type: "synthesis_fallback",
			error: (err as Error).message.slice(0, 300),
		});
		report = fallbackReport(query, results, synthesizerModel);
	}
	stats.durationMs = Date.now() - startedAt;
	emit({
		type: "report_complete",
		report,
		stats,
		model: report.model ?? synthesizerModel,
	});

	return { report, stats, results, plan };
}

/**
 * Deterministic last-resort report: no LLM, just the researched sub-answers
 * and their sources. Guarantees the run always produces usable output.
 */
function fallbackReport(
	query: string,
	results: ResearchResult[],
	model?: string,
) {
	const citations = new Map<
		string,
		{ id: string; url: string; title: string; publishedDate?: string }
	>();
	const sections = results.map((r) => {
		const sourceIds: string[] = [];
		for (const s of r.sources) {
			if (!citations.has(s.url)) {
				citations.set(s.url, {
					id: `s${citations.size + 1}`,
					url: s.url,
					title: s.title,
					publishedDate: s.publishedDate,
				});
			}
			sourceIds.push(citations.get(s.url)?.id ?? "");
		}
		return {
			subquestionId: r.subquestionId,
			question: r.question,
			depth: r.depth,
			answer: r.answer,
			sourceIds,
		};
	});
	return {
		title: query,
		summary:
			results.length > 0
				? "Automatic synthesis failed — the sub-answers below were researched successfully but are not merged."
				: "No sub-answers could be researched (all attempts failed or the budget was exhausted).",
		sections,
		citations: [...citations.values()],
		model,
	};
}

/** Tiny promise semaphore to cap parallel LLM/search fan-out. */
function semaphore(limit: number) {
	let active = 0;
	const queue: Array<() => void> = [];
	const next = () => {
		active--;
		queue.shift()?.();
	};
	const run = async <T>(task: () => Promise<T>): Promise<T> => {
		if (active >= limit) await new Promise<void>((res) => queue.push(res));
		active++;
		try {
			return await task();
		} finally {
			next();
		}
	};
	return run;
}
