import { z } from "zod";
import type { AgentConfig } from "./config";
import { type Llm, resolveModel } from "./llm";
import type { Report, ReportSection, ResearchResult, Source } from "./types";
import { reportSchema, reportSectionSchema } from "./types";

const SYNTHESIZER_SYSTEM = `You are the synthesizer of a recursive research agent. You are given the user's question and several sub-answers, each with cited sources.

Write a final report as a JSON object:
{"title":"...","summary":"...","sections":[{"question":"...","answer":"..."}]}

Rules:
- summary: 2-4 sentences directly answering the user's question, citing [1], [2] matching the source list.
- sections: one per sub-question, reusing each sub-answer (lightly edited).
- Do not invent sources or facts.
- Return ONLY a JSON object, no prose, no markdown fences.`;

export interface SynthesizerDeps {
	llm: Llm;
	config: AgentConfig;
}

const synthesizerOutputSchema = z.object({
	title: z.string().min(1),
	summary: z.string().min(1),
	sections: z.array(
		z.object({
			question: z.string().min(1),
			answer: z.string().min(1),
		}),
	),
});

/** Synthesizer role: accepted ResearchResults -> FinalReport. */
export async function synthesizeReport(
	userQuery: string,
	results: ResearchResult[],
	deps: SynthesizerDeps,
): Promise<Report> {
	const { llm, config } = deps;

	// Deduplicate sources across sub-answers and assign stable citation ids.
	const seen = new Map<string, Source>();
	const sectionSourceIds: string[][] = [];
	const resultsBlock = results
		.map((r, i) => {
			const ids: string[] = [];
			for (const s of r.sources) {
				if (!seen.has(s.url)) {
					seen.set(s.url, s);
				}
				const id = `s${[...seen.keys()].indexOf(s.url) + 1}`;
				ids.push(id);
			}
			sectionSourceIds[i] = ids;
			return `[Sub-question ${i + 1}] ${r.question}\nAnswer: ${r.answer}\nSources: ${ids.join(", ")}`;
		})
		.join("\n\n");

	const citationsBlock = [...seen.values()]
		.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`)
		.join("\n");

	const prompt = `${SYNTHESIZER_SYSTEM}\n\nUser question: ${userQuery}\n\nSub-answers:\n${resultsBlock}\n\nSource list:\n${citationsBlock}\n\nWrite the report JSON.`;

	let lastError: unknown;
	for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
		try {
			const output = await llm.generateJson(prompt, synthesizerOutputSchema, {
				model: resolveModel(config, "synthesizer"),
				maxOutputTokens: 2000,
			});
			const sections: ReportSection[] = output.sections.map((s, i) =>
				reportSectionSchema.parse({
					subquestionId: results[i]?.subquestionId ?? `q${i + 1}`,
					question: s.question,
					depth: results[i]?.depth ?? 0,
					answer: s.answer,
					sourceIds: sectionSourceIds[i] ?? [],
				}),
			);
			const citations = [...seen.entries()].map(([url, src], i) => ({
				id: `s${i + 1}`,
				url,
				title: src.title,
				publishedDate: src.publishedDate,
			}));
			return reportSchema.parse({
				title: output.title,
				summary: output.summary,
				sections,
				citations,
			});
		} catch (err) {
			lastError = err;
		}
	}
	throw new Error(
		`Synthesizer failed after ${config.maxRetries + 1} attempts: ${String(lastError)}`,
	);
}
