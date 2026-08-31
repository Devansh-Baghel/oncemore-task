// Orchestrator unit test with a fake LLM + fake search (no network, no credits).
import "dotenv/config";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { z } from "zod";
import type { Llm } from "./llm";
import { runResearch } from "./orchestrator";
import type { AgentEvent } from "./types";

// Mock Exa search so tests don't hit the network / need API keys.
const originalFetch = globalThis.fetch;
beforeEach(() => {
	globalThis.fetch = (async (input: unknown, init?: unknown) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: (input as { url: string }).url;
		if (url.includes("api.exa.ai")) {
			return new Response(
				JSON.stringify({
					results: [
						{
							title: "Test source",
							url: "https://example.com/a",
							highlights: ["highlight text"],
							text: "Full text of test source for the subquestion answer.",
							publishedDate: "2024-01-01",
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}
		// fallback to real fetch for other URLs
		return originalFetch(input as never, init as never);
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

/** Fake LLM: returns canned JSON per role based on prompt hints. */
function makeFakeLlm(): Llm {
	return {
		async complete() {
			return "";
		},
		async generateJson<T>(prompt: string, _schema: z.ZodType<T>): Promise<T> {
			if (prompt.includes("planner of a recursive research agent")) {
				return {
					subquestions: [
						{ id: "q1", question: "What is subquestion one?" },
						{ id: "q2", question: "What is subquestion two?" },
					],
				} as T;
			}
			if (prompt.includes("critic of a recursive research agent")) {
				// Recurses only for subquestion two (to test the recursion path).
				if (prompt.includes("Sub-question: What is subquestion two?")) {
					return {
						decision: "recurse",
						reason: "needs more depth",
						followUpQuestion: "Follow-up on two?",
					} as T;
				}
				return { decision: "accept", reason: "good enough" } as T;
			}
			if (prompt.includes("researcher of a recursive research agent")) {
				return { answer: "A factual answer.", sourceNumbers: [1] } as T;
			}
			if (prompt.includes("synthesizer of a recursive research agent")) {
				return {
					title: "Test report",
					summary: "Short summary [1].",
					sections: [
						{ question: "What is subquestion one?", answer: "Answer one." },
					],
				} as T;
			}
			throw new Error(`Unexpected prompt: ${prompt.slice(0, 80)}`);
		},
	};
}

test("runResearch: planner -> parallel researchers -> critic -> recurse -> report", async () => {
	const events: AgentEvent[] = [];
	const { report, stats, results, plan } = await runResearch({
		query: "Test query",
		llm: makeFakeLlm(),
		callbacks: { onEvent: (e) => events.push(e) },
	});

	expect(plan.subquestions).toHaveLength(2);
	expect(results.length).toBe(3); // q1, q2, q2-r (recursed)
	expect(stats.recursions).toBe(1);
	expect(report.summary).toContain("[1]");

	const types = events.map((e) => e.type);
	expect(types).toContain("plan_created");
	expect(types).toContain("search_started");
	expect(types).toContain("verdict");
	expect(types).toContain("recurse");
	expect(types).toContain("report_complete");

	const recurseEvent = events.find((e) => e.type === "recurse");
	expect(recurseEvent).toBeDefined();
});

test("runResearch: budget cap stops recursion gracefully", async () => {
	const events: AgentEvent[] = [];
	const { report, stats } = await runResearch({
		query: "Test query",
		config: { maxTotalSearches: 2, maxDepth: 5 },
		llm: makeFakeLlm(),
		callbacks: { onEvent: (e) => events.push(e) },
	});

	// 2 searches happen (q1, q2); the recurse attempt hits the cap.
	expect(stats.searches).toBe(2);
	expect(events.some((e) => e.type === "budget_hit")).toBe(true);
	// Graceful: still produced a report with what we had.
	expect(report.summary).toBeTruthy();
});

test("runResearch: one researcher failure degrades instead of killing the run", async () => {
	const flaky: Llm = {
		async complete() {
			return "";
		},
		async generateJson<T>(prompt: string, _schema: z.ZodType<T>): Promise<T> {
			if (prompt.includes("planner of a recursive research agent")) {
				return {
					subquestions: [
						{ id: "q1", question: "What is subquestion one?" },
						{ id: "q2", question: "What is subquestion two?" },
					],
				} as T;
			}
			if (prompt.includes("researcher of a recursive research agent")) {
				// q2's research attempt always fails (simulates a hung/dead API).
				if (prompt.includes("Sub-question: What is subquestion two?")) {
					throw new Error("API unavailable");
				}
				return { answer: "A factual answer.", sourceNumbers: [1] } as T;
			}
			if (prompt.includes("critic of a recursive research agent")) {
				return { decision: "accept", reason: "good enough" } as T;
			}
			if (prompt.includes("synthesizer of a recursive research agent")) {
				return {
					title: "Test report",
					summary: "Short summary.",
					sections: [
						{ question: "What is subquestion one?", answer: "Answer one." },
					],
				} as T;
			}
			throw new Error(`Unexpected prompt: ${prompt.slice(0, 80)}`);
		},
	};

	const events: AgentEvent[] = [];
	const { report, results } = await runResearch({
		query: "Test query",
		config: { maxRetries: 0 },
		llm: flaky,
		callbacks: { onEvent: (e) => events.push(e) },
	});

	// q1 survived, q2 emitted a failure event, and the run still completed.
	expect(results.map((r) => r.subquestionId)).toEqual(["q1"]);
	const failed = events.find((e) => e.type === "subquestion_failed");
	expect(failed).toBeDefined();
	if (failed?.type === "subquestion_failed") {
		expect(failed.subquestionId).toBe("q2");
	}
	expect(report.title).toBe("Test report");
});

test("runResearch: synthesizer failure falls back to an assembled report", async () => {
	const badSynth: Llm = {
		async complete() {
			return "";
		},
		async generateJson<T>(prompt: string, _schema: z.ZodType<T>): Promise<T> {
			if (prompt.includes("planner of a recursive research agent")) {
				return {
					subquestions: [{ id: "q1", question: "What is subquestion one?" }],
				} as T;
			}
			if (prompt.includes("researcher of a recursive research agent")) {
				return { answer: "A factual answer.", sourceNumbers: [1] } as T;
			}
			if (prompt.includes("critic of a recursive research agent")) {
				return { decision: "accept", reason: "good enough" } as T;
			}
			// Synthesizer always fails.
			throw new Error("synthesis exploded");
		},
	};

	const events: AgentEvent[] = [];
	const { report } = await runResearch({
		query: "Test query",
		config: { maxRetries: 0 },
		llm: badSynth,
		callbacks: { onEvent: (e) => events.push(e) },
	});

	expect(events.some((e) => e.type === "synthesis_fallback")).toBe(true);
	// The fallback report carries the researched answer + sources.
	expect(report.title).toBe("Test query");
	expect(report.sections).toHaveLength(1);
	expect(report.sections[0]?.answer).toBe("A factual answer.");
});

test("runResearch: every agent response includes model", async () => {
	const events: AgentEvent[] = [];
	const { report, results } = await runResearch({
		query: "Test query",
		llm: makeFakeLlm(),
		callbacks: { onEvent: (e) => events.push(e) },
	});

	const planEvent = events.find((e) => e.type === "plan_created");
	expect(planEvent).toBeDefined();
	if (planEvent?.type === "plan_created") {
		expect(planEvent.model).toBe("openai/gpt-oss-20b");
	}

	// researcher results carry model
	for (const r of results) {
		expect(r.model).toBe("openai/gpt-oss-20b");
	}
	const resultEvents = events.filter((e) => e.type === "result_produced");
	for (const e of resultEvents) {
		if (e.type === "result_produced") expect(e.result.model).toBeTruthy();
	}

	const verdictEvent = events.find((e) => e.type === "verdict");
	expect(verdictEvent).toBeDefined();
	if (verdictEvent?.type === "verdict") {
		expect(verdictEvent.model).toBe("openai/gpt-oss-20b");
	}

	const reportEvent = events.find((e) => e.type === "report_complete");
	expect(reportEvent).toBeDefined();
	if (reportEvent?.type === "report_complete") {
		expect(reportEvent.model).toBe("openai/gpt-oss-120b");
		expect(reportEvent.report.model).toBe("openai/gpt-oss-120b");
	}
	expect(report.model).toBe("openai/gpt-oss-120b");

	// bedrock provider resolves per-role models
	const bedrockEvents: AgentEvent[] = [];
	await runResearch({
		query: "Test query",
		config: { provider: "bedrock" },
		llm: makeFakeLlm(),
		callbacks: { onEvent: (e) => bedrockEvents.push(e) },
	});
	const bPlan = bedrockEvents.find((e) => e.type === "plan_created");
	if (bPlan?.type === "plan_created") expect(bPlan.model).toBe("anthropic.claude-sonnet-4-6-v1");
	const bReport = bedrockEvents.find((e) => e.type === "report_complete");
	if (bReport?.type === "report_complete") expect(bReport.model).toBe("anthropic.claude-sonnet-4-6-v1");
});
