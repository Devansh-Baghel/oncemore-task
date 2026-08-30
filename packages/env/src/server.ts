import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		CORS_ORIGIN: z.url(),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		NVIDIA_NIM_API_KEY: z
			.string()
			.min(1)
			.describe("NVIDIA NIM (build.nvidia.com) API key"),
		EXA_API_KEY: z.string().min(1).describe("Exa search API key"),
		NIM_BASE_URL: z.url().default("https://integrate.api.nvidia.com/v1"),
		AWS_BEDROCK_API_KEY: z
			.string()
			.optional()
			.describe("AWS Bedrock API key (us-east-1)"),
		AWS_BEDROCK_REGION: z
			.string()
			.default("us-east-1")
			.describe("AWS Bedrock region"),
	},
	runtimeEnv: process.env,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
