import { z } from "zod";
import type { AgentConfig } from "./config";
import { type Llm, resolveModel } from "./llm";
import type { Plan } from "./types";
import { planSchema, subquestionSchema } from "./types";

const plannerOutputSchema = z.object({
	subquestions: z
		.array(z.object({ id: z.string().min(1), question: z.string().min(1) }))
		.min(1)
		.max(5),
});

const PLANNER_SYSTEM = `You are the planner of a recursive research agent. Decompose the user's research question into 3-5 independent sub-questions that together cover the topic.

Rules:
- Each sub-question must be self-contained and directly searchable on the web.
- Prefer questions an answer can cite from a small number of sources.
- Do not include meta questions like "what is the history of X" unless essential.
- Return ONLY a JSON object, no prose, no markdown fences:
{"subquestions":[{"id":"q1","question":"..."}]}`;

export interface PlannerDeps {
	llm: Llm;
	config: AgentConfig;
}

/**
 * Planner role: user query -> structured Plan.
 * Uses JSON-instruct (NIM doesn't support native structured output) then
 * validates with zod, retrying once on parse/validation failure.
 */
export async function planResearch(
	query: string,
	deps: PlannerDeps,
): Promise<Plan> {
	const { llm, config } = deps;
	const prompt = `${PLANNER_SYSTEM}\n\nUser question: ${query}`;

	let lastError: unknown;
	for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
		try {
			const output = await llm.generateJson(prompt, plannerOutputSchema, {
				model: resolveModel(config, "planner"),
				maxOutputTokens: 900,
			});
			// Attach depth 0 and normalize ids to q1..qN.
			const subquestions = output.subquestions.map((sq, i) =>
				subquestionSchema.parse({
					id: `q${i + 1}`,
					question: sq.question,
					depth: 0,
				}),
			);
			return planSchema.parse({ subquestions });
		} catch (err) {
			lastError = err;
		}
	}
	throw new Error(
		`Planner failed after ${config.maxRetries + 1} attempts: ${String(lastError)}`,
	);
}
