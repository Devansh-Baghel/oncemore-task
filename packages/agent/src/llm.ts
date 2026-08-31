import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "@oncemore/env/server";
import { generateText } from "ai";
import type { z } from "zod";
import type { AgentConfig } from "./config";

/**
 * The provider abstraction every role depends on. Keeping this an interface
 * means tests can inject a fake LLM (no network, no credits) and the real
 * implementation is swappable via config.
 */
export interface Llm {
	/** Free-form text completion. */
	complete(
		prompt: string,
		opts?: { model?: string; maxOutputTokens?: number },
	): Promise<string>;
	/** JSON-instruct completion parsed + validated against a zod schema. */
	generateJson<T>(
		prompt: string,
		schema: z.ZodType<T>,
		opts?: { model?: string; maxOutputTokens?: number },
	): Promise<T>;
}

const nim = createOpenAICompatible({
	baseURL: env.NIM_BASE_URL,
	name: "nim",
	apiKey: env.NVIDIA_NIM_API_KEY,
});

function getBedrock() {
	return createAmazonBedrock({
		region: env.AWS_BEDROCK_REGION ?? "us-east-1",
		apiKey: env.AWS_BEDROCK_API_KEY,
	});
}

/**
 * Strips markdown code fences and trims to the outermost JSON object.
 * NIM models sometimes wrap JSON in ```json fences or add prose.
 */
export function extractJson(text: string): string {
	const cleaned = text
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/```\s*$/m, "")
		.trim();
	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) {
		throw new Error(
			`No JSON object found in model output: ${cleaned.slice(0, 200)}`,
		);
	}
	return cleaned.slice(start, end + 1);
}

/**
 * Diagnostic logging to stderr (kept separate from stdout so the CLI report
 * stays clean). Enabled by default; AGENT_DEBUG=0 silences it.
 */
export function debugLog(message: string): void {
	if (process.env.AGENT_DEBUG === "0") return;
	console.error(`[debug ${new Date().toISOString().slice(11, 23)}] ${message}`);
}

export interface NimLlmOptions {
	/** Total attempts per call (1 = no retry). Default 3. */
	maxRetries: number;
	/** Base delay between attempts in ms; doubles each retry, capped at 8s. */
	retryDelayMs: number;
	/** Hard timeout per attempt — NIM models can hang indefinitely. */
	timeoutMs: number;
}

const nimLlmDefaults: NimLlmOptions = {
	maxRetries: 2,
	retryDelayMs: 1000,
	timeoutMs: 60000,
};

function delay(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(baseMs: number, attempt: number): number {
	return Math.min(baseMs * 2 ** attempt, 8000);
}

export class NimLlm implements Llm {
	private readonly opts: NimLlmOptions;

	constructor(opts?: Partial<NimLlmOptions>) {
		this.opts = { ...nimLlmDefaults, ...opts };
	}

	async complete(
		prompt: string,
		opts?: { model?: string; maxOutputTokens?: number },
	): Promise<string> {
		const model = opts?.model ?? defaultWorkerModel();
		// Transport-level retry with backoff: timeouts, 5xx, network errors.
		let lastError: unknown;
		for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
			const t0 = Date.now();
			debugLog(
				`llm:start model=${model} attempt=${attempt + 1}/${this.opts.maxRetries + 1} promptChars=${prompt.length} maxOutputTokens=${opts?.maxOutputTokens ?? 1024}`,
			);
			try {
				const { text, finishReason, usage } = await generateText({
					model: nim.chatModel(model),
					prompt,
					maxOutputTokens: opts?.maxOutputTokens ?? 1024,
					// Without this, a hung NIM request stalls the whole run forever.
					abortSignal: AbortSignal.timeout(this.opts.timeoutMs),
				});
				debugLog(
					`llm:done model=${model} duration=${Date.now() - t0}ms textChars=${text.length} finishReason=${finishReason} outTokens=${usage.outputTokens ?? "?"} reasoningTokens=${usage.outputTokenDetails.reasoningTokens ?? 0}`,
				);
				if (text.length === 0) {
					debugLog(
						`llm:empty-content model=${model} finishReason=${finishReason} — output tokens likely consumed by reasoning`,
					);
				}
				return text;
			} catch (err) {
				const msg = (err as Error).message.slice(0, 200);
				debugLog(
					`llm:error model=${model} duration=${Date.now() - t0}ms attempt=${attempt + 1} error=${msg}`,
				);
				lastError = err;
				if (attempt < this.opts.maxRetries) {
					const wait = backoffDelay(this.opts.retryDelayMs, attempt);
					debugLog(`llm:retry model=${model} in ${wait}ms`);
					await delay(wait);
				}
			}
		}
		throw new Error(
			`LLM call failed after ${this.opts.maxRetries + 1} attempts: ${String(lastError)}`,
		);
	}

	async generateJson<T>(
		prompt: string,
		schema: z.ZodType<T>,
		opts?: { model?: string; maxOutputTokens?: number },
	): Promise<T> {
		const model = opts?.model ?? defaultWorkerModel();
		// JSON-level retry: covers both transport failures (via complete)
		// and parse/validation failures (truncated output, prose, wrong shape).
		let lastError: unknown;
		for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
			try {
				const text = await this.complete(prompt, opts);
				const json = extractJson(text);
				const parsed = schema.parse(JSON.parse(json));
				debugLog(`json:ok model=${model} attempt=${attempt + 1}`);
				return parsed;
			} catch (err) {
				const msg = (err as Error).message.slice(0, 200);
				debugLog(
					`json:fail model=${model} attempt=${attempt + 1} error=${msg}`,
				);
				lastError = err;
				if (attempt < this.opts.maxRetries) {
					const wait = backoffDelay(this.opts.retryDelayMs, attempt);
					debugLog(`json:retry model=${model} in ${wait}ms`);
					await delay(wait);
				}
			}
		}
		throw new Error(
			`generateJson failed after ${this.opts.maxRetries + 1} attempts: ${String(lastError)}`,
		);
	}
}

export class BedrockLlm implements Llm {
	private readonly opts: NimLlmOptions;

	constructor(opts?: Partial<NimLlmOptions>) {
		this.opts = { ...nimLlmDefaults, ...opts };
	}

	async complete(
		prompt: string,
		opts?: { model?: string; maxOutputTokens?: number },
	): Promise<string> {
		const model = opts?.model ?? defaultBedrockModel();
		let lastError: unknown;
		for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
			const t0 = Date.now();
			debugLog(
				`llm:start provider=bedrock model=${model} attempt=${attempt + 1}/${this.opts.maxRetries + 1} promptChars=${prompt.length} maxOutputTokens=${opts?.maxOutputTokens ?? 1024}`,
			);
			try {
				const bedrock = getBedrock();
				const { text, finishReason, usage } = await generateText({
					model: bedrock(model as never),
					prompt,
					maxOutputTokens: opts?.maxOutputTokens ?? 1024,
					abortSignal: AbortSignal.timeout(this.opts.timeoutMs),
				});
				debugLog(
					`llm:done provider=bedrock model=${model} duration=${Date.now() - t0}ms textChars=${text.length} finishReason=${finishReason} outTokens=${usage.outputTokens ?? "?"} reasoningTokens=${usage.outputTokenDetails.reasoningTokens ?? 0}`,
				);
				if (text.length === 0) {
					debugLog(
						`llm:empty-content provider=bedrock model=${model} finishReason=${finishReason}`,
					);
				}
				return text;
			} catch (err) {
				const msg = (err as Error).message.slice(0, 300);
				debugLog(
					`llm:error provider=bedrock model=${model} duration=${Date.now() - t0}ms attempt=${attempt + 1} error=${msg}`,
				);
				lastError = err;
				if (attempt < this.opts.maxRetries) {
					const wait = backoffDelay(this.opts.retryDelayMs, attempt);
					debugLog(`llm:retry provider=bedrock model=${model} in ${wait}ms`);
					await delay(wait);
				}
			}
		}
		throw new Error(
			`Bedrock LLM call failed after ${this.opts.maxRetries + 1} attempts: ${String(lastError)}`,
		);
	}

	async generateJson<T>(
		prompt: string,
		schema: z.ZodType<T>,
		opts?: { model?: string; maxOutputTokens?: number },
	): Promise<T> {
		const model = opts?.model ?? defaultBedrockModel();
		let lastError: unknown;
		for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
			try {
				const text = await this.complete(prompt, opts);
				const json = extractJson(text);
				const parsed = schema.parse(JSON.parse(json));
				debugLog(
					`json:ok provider=bedrock model=${model} attempt=${attempt + 1}`,
				);
				return parsed;
			} catch (err) {
				const msg = (err as Error).message.slice(0, 300);
				debugLog(
					`json:fail provider=bedrock model=${model} attempt=${attempt + 1} error=${msg}`,
				);
				lastError = err;
				if (attempt < this.opts.maxRetries) {
					const wait = backoffDelay(this.opts.retryDelayMs, attempt);
					debugLog(`json:retry provider=bedrock model=${model} in ${wait}ms`);
					await delay(wait);
				}
			}
		}
		throw new Error(
			`Bedrock generateJson failed after ${this.opts.maxRetries + 1} attempts: ${String(lastError)}`,
		);
	}
}

/**
 * Factory: returns the correct Llm implementation for a config provider.
 * Uses the same retry/timeout knobs as NimLlm.
 */
export function createLlm(
	config: Pick<
		AgentConfig,
		"provider" | "maxRetries" | "retryDelayMs" | "llmTimeoutMs"
	>,
): Llm {
	const opts = {
		maxRetries: config.maxRetries,
		retryDelayMs: config.retryDelayMs,
		timeoutMs: config.llmTimeoutMs,
	};
	if (config.provider === "bedrock") {
		if (!env.AWS_BEDROCK_API_KEY) {
			throw new Error(
				"AWS_BEDROCK_API_KEY is not set — cannot use bedrock provider. Set it in apps/server/.env",
			);
		}
		return new BedrockLlm(opts);
	}
	return new NimLlm(opts);
}

/**
 * Resolve the model ID for a given role + provider.
 * Bedrock uses per-role models; NVIDIA uses worker/synthesizer.
 */
export function resolveModel(
	config: AgentConfig,
	role: "planner" | "researcher" | "critic" | "synthesizer",
): string {
	if (config.provider === "bedrock") {
		switch (role) {
			case "planner":
				return config.bedrockPlannerModel;
			case "researcher":
				return config.bedrockResearcherModel;
			case "critic":
				return config.bedrockCriticModel;
			case "synthesizer":
				return config.bedrockSynthesizerModel;
		}
	}
	return role === "synthesizer" ? config.synthesizerModel : config.workerModel;
}

// Default model names (avoid a circular import with config).
let workerModel = "openai/gpt-oss-20b";
export function setDefaultWorkerModel(model: string) {
	workerModel = model;
}
export function defaultWorkerModel() {
	return workerModel;
}

let bedrockModel = "us.anthropic.claude-sonnet-4-6";
export function setDefaultBedrockModel(model: string) {
	bedrockModel = model;
}
export function defaultBedrockModel() {
	return bedrockModel;
}
