"use client";

import { Badge } from "@oncemore/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@oncemore/ui/components/card";

export default function ConfigPage() {
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
						AWS Bedrock in us-east-1 is the sole LLM backend.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="rounded-xl border bg-muted/30 p-3 text-xs leading-relaxed">
						<div className="mb-2 flex flex-wrap gap-2">
							<Badge variant="outline">Planner: Sonnet 4.6</Badge>
							<Badge variant="outline">Researcher: GLM-4.7</Badge>
							<Badge variant="outline">Critic: GLM-5</Badge>
							<Badge variant="outline">Synthesizer: Sonnet 4.6</Badge>
						</div>
						<p className="text-muted-foreground">
							Bedrock models:{" "}
							<code className="rounded-md bg-muted px-1 py-0.5">
								us.anthropic.claude-sonnet-4-6
							</code>{" "}
							for planner/synthesizer,{" "}
							<code className="rounded-md bg-muted px-1 py-0.5">
								zai.glm-4.7
							</code>{" "}
							for researcher,{" "}
							<code className="rounded-md bg-muted px-1 py-0.5">zai.glm-5</code>{" "}
							for critic. Region{" "}
							<code className="rounded-md bg-muted px-1 py-0.5">us-east-1</code>
							. API key is server-side only.
						</p>
					</div>
				</CardContent>
			</Card>

			<p className="text-muted-foreground text-xs">
				More settings (models, search budgets, etc.) will appear here in the
				future.
			</p>
		</div>
	);
}
