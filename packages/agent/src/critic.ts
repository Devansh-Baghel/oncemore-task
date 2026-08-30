import { z } from "zod";
import type { AgentConfig } from "./config";
import { type Llm, resolveModel } from "./llm";
import type { ResearchResult, Verdict } from "./types";
import { verdictSchema } from "./types";

const CRITIC_SYSTEM = `You are the critic of a recursive research agent. Judge whether a sub-answer is strong enough to include in the final report.

A sub-answer is ACCEPT if it is specific, factual, and adequately supported by its sources.
It should RECURSE (one level deeper) if it is vague, incomplete, has contradictions, or raises an important follow-up question that the original query depends on.
It should FAIL only if the sources were useless and a deeper search would not help (e.g. no relevant results found).

Rules:
- "recurse" is expensive: only use it when a genuinely important gap exists.
- For "recurse", provide a specific, searchable followUpQuestion.
- Return ONLY a JSON object, no prose, no markdown fences:
{"decision":"accept"|"recurse"|"fail","reason":"...","followUpQuestion":"..."}`;

export interface CriticDeps {
	llm: Llm;
	config: AgentConfig;
}

/** Critic role: ResearchResult -> Verdict (accept | recurse | fail). */
export async function judgeResult(
	result: ResearchResult,
	deps: CriticDeps,
): Promise<Verdict> {
	const { llm, config } = deps;

	const sourcesBlock = result.sources
		.map(
			(s, i) =>
				`[${i + 1}] ${s.title} (${s.url})\n${s.quotes.join(" ").slice(0, 300)}`,
		)
		.join("\n");

	const prompt = `${CRITIC_SYSTEM}\n\nSub-question: ${result.question}\n\nAnswer: ${result.answer}\n\nSources:\n${sourcesBlock}\n\nVerdict as JSON.`;

	const criticOutputSchema = z.object({
		decision: z.enum(["accept", "recurse", "fail"]),
		reason: z.string(),
		followUpQuestion: z.string().optional(),
	});

	let lastError: unknown;
	for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
		try {
			const output = await llm.generateJson(prompt, criticOutputSchema, {
				model: resolveModel(config, "critic"),
				maxOutputTokens: 500,
			});
			return verdictSchema.parse(output);
		} catch (err) {
			lastError = err;
		}
	}
	// A critic failure shouldn't kill the run — accept on error, note it.
	return {
		decision: "accept",
		reason: `Critic failed after ${config.maxRetries + 1} attempts (${String(lastError)}) — accepted by default`,
	} satisfies Verdict;
}
