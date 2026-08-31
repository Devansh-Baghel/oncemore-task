import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		CORS_ORIGIN: z.url(),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		EXA_API_KEY: z.string().min(1).describe("Exa search API key"),
		AWS_BEDROCK_API_KEY: z
			.string()
			.min(1)
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
