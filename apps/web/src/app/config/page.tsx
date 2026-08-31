"use client";

import { Badge } from "@oncemore/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@oncemore/ui/components/card";
import { Label } from "@oncemore/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@oncemore/ui/components/select";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getProvider, type Provider, setProvider } from "@/lib/config-store";

export default function ConfigPage() {
	const [provider, setProviderState] = useState<Provider>("nvidia");

	useEffect(() => {
		setProviderState(getProvider());
	}, []);

	function handleChange(value: string | null) {
		if (!value) return;
		const next = value as Provider;
		setProviderState(next);
		setProvider(next);
		toast.success(
			`Provider set to ${next === "bedrock" ? "AWS Bedrock (us-east-1)" : "NVIDIA NIM"}`,
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
			<div>
				<h1 className="font-semibold text-lg">Config</h1>
				<p className="text-muted-foreground text-xs">
					Adjust runtime settings for the research agent.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>LLM Provider</CardTitle>
					<CardDescription>
						Choose which LLM backend the agent uses. Stored in localStorage and
						sent with each research request.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="provider">Provider</Label>
						<Select value={provider} onValueChange={handleChange}>
							<SelectTrigger id="provider" className="w-[280px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="nvidia">NVIDIA NIM</SelectItem>
								<SelectItem value="bedrock">AWS Bedrock (us-east-1)</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-muted-foreground text-xs">
							{provider === "nvidia"
								? "Uses NVIDIA NIM (build.nvidia.com) — gpt-oss-20b / 120b"
								: "Uses AWS Bedrock in us-east-1 — Sonnet 4.6 / GLM-4.7 / GLM-5"}
						</p>
					</div>

					{provider === "bedrock" && (
						<div className="rounded-none border bg-muted/30 p-3 text-xs leading-relaxed">
							<div className="mb-2 flex flex-wrap gap-2">
								<Badge variant="outline">Planner: Sonnet 4.6</Badge>
								<Badge variant="outline">Researcher: GLM-4.7</Badge>
								<Badge variant="outline">Critic: GLM-5</Badge>
								<Badge variant="outline">Synthesizer: Sonnet 4.6</Badge>
							</div>
							<p className="text-muted-foreground">
								Bedrock models:{" "}
								<code className="rounded bg-muted px-1 py-0.5">
									us.anthropic.claude-sonnet-4-6
								</code>{" "}
								for planner/synthesizer,{" "}
								<code className="rounded bg-muted px-1 py-0.5">
									zai.glm-4.7
								</code>{" "}
								for researcher,{" "}
								<code className="rounded bg-muted px-1 py-0.5">zai.glm-5</code>{" "}
								for critic. Region{" "}
								<code className="rounded bg-muted px-1 py-0.5">us-east-1</code>.
								API key is server-side only.
							</p>
						</div>
					)}
					{provider === "nvidia" && (
						<div className="rounded-none border bg-muted/30 p-3 text-xs">
							<div className="flex flex-wrap gap-2">
								<Badge variant="outline">Worker: openai/gpt-oss-20b</Badge>
								<Badge variant="outline">
									Synthesizer: openai/gpt-oss-120b
								</Badge>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			<p className="text-muted-foreground text-xs">
				More settings (models, search budgets, etc.) will appear here in the
				future.
			</p>
		</div>
	);
}
