import { env } from "@oncemore/env/server";
import { z } from "zod";
import type { AgentConfig } from "./config";
import type { Llm } from "./llm";
import { debugLog } from "./llm";
import type { ResearchResult, Source, Subquestion } from "./types";
import { researchResultSchema } from "./types";

export interface ExaSearchOptions {
	numResults: number;
	maxSourceChars: number;
	/** Hard timeout for the HTTP request (Exa can also stall). */
	timeoutMs: number;
}

/** Raw Exa search result (subset of the API response we need). */
interface ExaHit {
	title?: string;
	url?: string;
	publishedDate?: string;
	text?: string;
	highlights?: string[];
	score?: number;
}

/**
 * Calls Exa /search with contents extraction. Returns raw hits.
 * Kept separate from `researchSubquestion` so the orchestrator can emit
 * search_started/completed events around the actual network call.
 */
export async function exaSearch(
	query: string,
	opts: ExaSearchOptions,
): Promise<ExaHit[]> {
	const t0 = Date.now();
	debugLog(
		`exa:start queryChars=${query.length} numResults=${opts.numResults} timeoutMs=${opts.timeoutMs}`,
	);
	let res: Response;
	try {
		res = await fetch("https://api.exa.ai/search", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.EXA_API_KEY}`,
			},
			body: JSON.stringify({
				query,
				numResults: opts.numResults,
				type: "auto",
				contents: { text: true, highlights: true },
			}),
			// Without this, a stalled Exa request hangs the run forever.
			signal: AbortSignal.timeout(opts.timeoutMs),
		});
	} catch (err) {
		debugLog(
			`exa:error duration=${Date.now() - t0}ms error=${(err as Error).message.slice(0, 200)}`,
		);
		throw err;
	}
	if (!res.ok) {
		const body = await res.text();
		debugLog(
			`exa:http-error status=${res.status} duration=${Date.now() - t0}ms body=${body.slice(0, 150)}`,
		);
		throw new Error(`Exa search failed (${res.status}): ${body.slice(0, 300)}`);
	}
	const json = (await res.json()) as { results?: ExaHit[] };
	debugLog(
		`exa:done duration=${Date.now() - t0}ms hits=${json.results?.length ?? 0}`,
	);
	return json.results ?? [];
}

const RESEARCHER_SYSTEM = `You are the researcher of a recursive research agent. You are given a sub-question and web search results with highlights. Write a concise, factual answer to the sub-question, citing sources as [1], [2], etc. (matching the source numbers).

Rules:
- Base every factual claim on the provided sources; do not invent facts.
- If sources are insufficient, say what is missing.
- Keep the answer under 150 words — be concise.
- Return ONLY a JSON object, no prose, no markdown fences:
{"answer":"...","sourceNumbers":[1,2]}`;

export interface ResearcherDeps {
	llm: Llm;
	config: Pick<
		AgentConfig,
		| "maxSourcesPerSubquestion"
		| "maxSourceChars"
		| "workerModel"
		| "maxRetries"
		| "searchTimeoutMs"
	>;
}

/** Researcher role: subquestion + web -> cited ResearchResult. */
export async function researchSubquestion(
	subquestion: Subquestion,
	deps: ResearcherDeps,
): Promise<ResearchResult> {
	const { llm, config } = deps;

	const hits = await exaSearch(subquestion.question, {
		numResults: config.maxSourcesPerSubquestion,
		maxSourceChars: config.maxSourceChars,
		timeoutMs: config.searchTimeoutMs,
	});

	// Trim each hit's text to the context budget, prefer highlights.
	const sources: Source[] = hits
		.slice(0, config.maxSourcesPerSubquestion)
		.map((h, i) => ({
			url: h.url ?? "",
			title: h.title ?? h.url ?? `source ${i + 1}`,
			publishedDate: h.publishedDate,
			quotes: (h.highlights ?? []).slice(0, 2),
		}));

	const sourceBlock = hits
		.map((h, i) => {
			const text = h.highlights?.join(" ") || h.text || "";
			const trimmed =
				text.length > config.maxSourceChars
					? `${text.slice(0, config.maxSourceChars)}…`
					: text;
			return `[${i + 1}] ${h.title ?? h.url}\n${trimmed}`;
		})
		.join("\n\n");

	const prompt = `${RESEARCHER_SYSTEM}\n\nSub-question: ${subquestion.question}\n\nSearch results:\n${sourceBlock}\n\nWrite your answer as JSON.`;

	const answerSchema = z.object({
		answer: z.string().min(1),
		sourceNumbers: z.array(z.number().int().min(1)),
	});

	let answerText = "";
	let usedSourceNumbers: number[] = [];
	let lastError: unknown;
	for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
		try {
			const output = await llm.generateJson(prompt, answerSchema, {
				model: config.workerModel,
				maxOutputTokens: 700,
			});
			answerText = output.answer;
			usedSourceNumbers = output.sourceNumbers;
			break;
		} catch (err) {
			lastError = err;
		}
	}
	if (!answerText) {
		throw new Error(
			`Researcher failed after ${config.maxRetries + 1} attempts: ${String(lastError)}`,
		);
	}

	const citedSources = sources.filter((_, i) =>
		usedSourceNumbers.includes(i + 1),
	);
	return researchResultSchema.parse({
		subquestionId: subquestion.id,
		question: subquestion.question,
		depth: subquestion.depth,
		original: subquestion.depth === 0,
		answer: answerText,
		sources: citedSources.length > 0 ? citedSources : sources,
	});
}
