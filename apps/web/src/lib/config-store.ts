"use client";

// Bedrock is the sole LLM provider. This shim is kept for backwards
// compatibility with any persisted localStorage value.
export type Provider = "bedrock";

export function getProvider(): Provider {
	return "bedrock";
}

export function setProvider(_provider: Provider) {}

export function useProvider(): Provider {
	return "bedrock";
}
