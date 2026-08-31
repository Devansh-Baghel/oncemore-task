import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
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

function getBedrock() {
	return createAmazonBedrock({
		region: env.AWS_BEDROCK_REGION ?? "us-east-1",
		apiKey: env.AWS_BEDROCK_API_KEY,
	});
}

/**
 * Strips markdown code fences and trims to the outermost JSON object.
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

export interface BedrockLlmOptions {
	/** Total attempts per call (1 = no retry). Default 3. */
	maxRetries: number;
	/** Base delay between attempts in ms; doubles each retry, capped at 8s. */
	retryDelayMs: number;
	/** Hard timeout per attempt. */
	timeoutMs: number;
}

const bedrockLlmDefaults: BedrockLlmOptions = {
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

export class BedrockLlm implements Llm {
	private readonly opts: BedrockLlmOptions;

	constructor(opts?: Partial<BedrockLlmOptions>) {
		this.opts = { ...bedrockLlmDefaults, ...opts };
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
 * Factory: returns the Bedrock Llm implementation.
 */
export function createLlm(
	config: Pick<AgentConfig, "maxRetries" | "retryDelayMs" | "llmTimeoutMs">,
): Llm {
	const opts = {
		maxRetries: config.maxRetries,
		retryDelayMs: config.retryDelayMs,
		timeoutMs: config.llmTimeoutMs,
	};
	if (!env.AWS_BEDROCK_API_KEY) {
		throw new Error(
			"AWS_BEDROCK_API_KEY is not set — cannot use bedrock provider. Set it in apps/server/.env",
		);
	}
	return new BedrockLlm(opts);
}

/**
 * Resolve the model ID for a given role.
 */
export function resolveModel(
	config: AgentConfig,
	role: "planner" | "researcher" | "critic" | "synthesizer",
): string {
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

let bedrockModel = "us.anthropic.claude-sonnet-4-6";
export function setDefaultBedrockModel(model: string) {
	bedrockModel = model;
}
export function defaultBedrockModel() {
	return bedrockModel;
}
