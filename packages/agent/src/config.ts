import { z } from "zod";

/**
 * All knobs for the research run. Defaults are chosen for the free NIM tier
 * (~40 requests/min) and the Exa free tier: keep total searches low, run
 * sub-questions in parallel, and recurse only where the critic flags weakness.
 */
export const agentConfigSchema = z.object({
	/** LLM provider — nvidia NIM vs AWS Bedrock (us-east-1). */
	provider: z.enum(["nvidia", "bedrock"]).default("nvidia"),
	/** NIM chat model used by planner / researcher / critic. */
	workerModel: z.string().default("openai/gpt-oss-20b"),
	/** NIM chat model used by the synthesizer (larger/stronger). */
	synthesizerModel: z.string().default("openai/gpt-oss-120b"),
	/** Bedrock model for planner (Sonnet 4.6 default). */
	bedrockPlannerModel: z.string().default("anthropic.claude-sonnet-4-6-v1"),
	/** Bedrock model for researcher (GLM-4.7 default). */
	bedrockResearcherModel: z.string().default("zai.glm-4.7"),
	/** Bedrock model for critic (GLM-5 default). */
	bedrockCriticModel: z.string().default("zai.glm-5"),
	/** Bedrock model for synthesizer (Sonnet 4.6 default). */
	bedrockSynthesizerModel: z.string().default("anthropic.claude-sonnet-4-6-v1"),
	/** How many levels deep recursion may go. Query = depth 0, first recurse = 1. */
	maxDepth: z.number().int().min(0).default(2),
	/** Global hard cap on Exa searches for the whole run. */
	maxTotalSearches: z.number().int().min(1).default(10),
	/** Max sub-questions per planning pass. */
	maxSubquestionsPerLevel: z.number().int().min(1).max(5).default(5),
	/** Max Exa results per search. */
	maxSourcesPerSubquestion: z.number().int().min(1).max(10).default(5),
	/** Max result text chars passed to the LLM per source (context budget). */
	maxSourceChars: z.number().int().min(500).default(4000),
	/** Concurrency for parallel sub-question research. */
	parallelism: z.number().int().min(1).default(5),
	/** Retries for transient failures (transport errors, JSON parse failures). */
	maxRetries: z.number().int().min(0).default(2),
	/** Base delay between retries in ms (doubles each attempt, capped at 8s). */
	retryDelayMs: z.number().int().min(0).default(1000),
	/** Hard timeout per LLM call — NIM models can hang indefinitely. */
	llmTimeoutMs: z.number().int().min(5000).default(60000),
	/** Hard timeout per Exa search. */
	searchTimeoutMs: z.number().int().min(2000).default(30000),
	/** Whether to emit pretty console logs alongside events. */
	verbose: z.boolean().default(true),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const defaultConfig: AgentConfig = agentConfigSchema.parse({});
