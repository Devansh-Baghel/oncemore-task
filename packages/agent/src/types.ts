import { z } from "zod";

/** A single searchable sub-question produced by the planner. */
export const subquestionSchema = z.object({
	id: z.string().min(1),
	question: z.string().min(1),
	/** 0 for the original query; increments by 1 each recursion. */
	depth: z.number().int().min(0),
});

export type Subquestion = z.infer<typeof subquestionSchema>;

/** Structured handoff from Planner -> Researcher(s). */
export const planSchema = z.object({
	subquestions: z.array(subquestionSchema).min(1).max(5),
});

export type Plan = z.infer<typeof planSchema>;

/** A single cited source found by Exa. */
export const sourceSchema = z.object({
	url: z.string().url(),
	title: z.string(),
	publishedDate: z.string().optional(),
	/** Short verbatim snippets supporting the answer. */
	quotes: z.array(z.string()).max(4),
});

export type Source = z.infer<typeof sourceSchema>;

/**
 * Structured handoff from Researcher -> Critic.
 * `depth` tracks how deep this answer was researched (0 = original subquestion).
 */
export const researchResultSchema = z.object({
	subquestionId: z.string(),
	question: z.string(),
	depth: z.number().int().min(0),
	/** Whether this is the original subquestion (false = recursed follow-up). */
	original: z.boolean(),
	answer: z.string(),
	sources: z.array(sourceSchema),
});

export type ResearchResult = z.infer<typeof researchResultSchema>;

/** Structured handoff from Critic -> Orchestrator (recursion decision). */
export const verdictSchema = z.object({
	decision: z.enum(["accept", "recurse", "fail"]),
	reason: z.string(),
	followUpQuestion: z.string().optional(),
});

export type Verdict = z.infer<typeof verdictSchema>;

/** A section of the final report (one per accepted sub-answer). */
export const reportSectionSchema = z.object({
	subquestionId: z.string(),
	question: z.string(),
	depth: z.number().int().min(0),
	answer: z.string(),
	sourceIds: z.array(z.string()),
});

export type ReportSection = z.infer<typeof reportSectionSchema>;

/** Final synthesized report. */
export const reportSchema = z.object({
	title: z.string(),
	summary: z.string(),
	sections: z.array(reportSectionSchema),
	citations: z.array(
		z.object({
			id: z.string(),
			url: z.string(),
			title: z.string(),
			publishedDate: z.string().optional(),
		}),
	),
});

export type Report = z.infer<typeof reportSchema>;

/**
 * Event stream emitted by the orchestrator. The CLI logger and the web UI
 * both consume this same stream, so "why did the agent do X" is observable
 * in one place.
 */
export type AgentEvent =
	| { type: "research_started"; query: string; config: unknown }
	| { type: "plan_created"; plan: Plan }
	| {
			type: "search_started";
			subquestionId: string;
			query: string;
			depth: number;
	  }
	| {
			type: "search_completed";
			subquestionId: string;
			depth: number;
			sourceCount: number;
			durationMs: number;
	  }
	| { type: "result_produced"; result: ResearchResult }
	| {
			type: "subquestion_failed";
			subquestionId: string;
			question: string;
			depth: number;
			error: string;
	  }
	| { type: "verdict"; subquestionId: string; depth: number; verdict: Verdict }
	| {
			type: "recurse";
			subquestionId: string;
			followUpQuestion: string;
			newDepth: number;
	  }
	| { type: "budget_hit"; reason: "depth" | "searches" }
	| { type: "synthesis_fallback"; error: string }
	| { type: "report_complete"; report: Report; stats: RunStats };

export type RunStats = {
	searches: number;
	llmCalls: number;
	recursions: number;
	durationMs: number;
};

/** Where the search budget was spent (for logging). */
export type BudgetSpend = "search" | "llm";
