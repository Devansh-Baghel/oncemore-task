"use client";

import type { AgentEvent, Report, Verdict } from "@oncemore/agent";
import { Button } from "@oncemore/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@oncemore/ui/components/card";
import { Input } from "@oncemore/ui/components/input";
import { Label } from "@oncemore/ui/components/label";
import { Loader2, Play } from "lucide-react";
import { useState } from "react";

const SERVER_URL =
	process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";

type TimelineEntry =
	| { kind: "event"; event: AgentEvent }
	| { kind: "done"; report: Report; stats: unknown };

function verdictBadge(verdict: Verdict) {
	switch (verdict.decision) {
		case "accept":
			return (
				<span className="rounded bg-green-500/15 px-1.5 py-0.5 text-green-600 text-xs">
					accept
				</span>
			);
		case "recurse":
			return (
				<span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-600 text-xs">
					recurse
				</span>
			);
		case "fail":
			return (
				<span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-600 text-xs">
					fail
				</span>
			);
	}
}

function EventLine({ event }: { event: AgentEvent }) {
	switch (event.type) {
		case "research_started":
			return (
				<div className="text-sm">
					<span className="font-medium">[run]</span> researching:{" "}
					<span className="text-foreground/80">{event.query}</span>
				</div>
			);
		case "plan_created":
			return (
				<div className="text-sm">
					<span className="font-medium">[planner]</span> plan {"->"}{" "}
					{event.plan.subquestions.length} sub-questions
					<ul className="mt-1 list-inside list-disc pl-4 text-foreground/70">
						{event.plan.subquestions.map((sq) => (
							<li key={sq.id}>
								<span className="font-mono text-xs">{sq.id}</span>:{" "}
								{sq.question}
							</li>
						))}
					</ul>
				</div>
			);
		case "search_started":
			return (
				<div className="text-sm">
					<span className="font-medium">[researcher]</span> searching{" "}
					<span className="text-foreground/80">"{event.query}"</span>
					{event.depth > 0 && (
						<span className="ml-1 text-amber-500 text-xs">
							(depth {event.depth})
						</span>
					)}
				</div>
			);
		case "search_completed":
			return (
				<div className="text-foreground/70 text-sm">
					<span className="font-medium">[researcher]</span> got{" "}
					{event.sourceCount} sources for {event.subquestionId} in{" "}
					{event.durationMs}ms
				</div>
			);
		case "result_produced":
			return (
				<div className="text-sm">
					<span className="font-medium">[researcher]</span>{" "}
					{event.result.subquestionId} {"->"} {event.result.answer.length}{" "}
					chars, {event.result.sources.length} sources
				</div>
			);
		case "subquestion_failed":
			return (
				<div className="text-red-600 text-sm">
					<span className="font-medium">[researcher]</span> FAILED{" "}
					{event.subquestionId}: {event.error} — continuing without it
				</div>
			);
		case "verdict":
			return (
				<div className="text-sm">
					<span className="font-medium">[critic]</span> {event.subquestionId}{" "}
					(depth {event.depth}) {"->"} {verdictBadge(event.verdict)}{" "}
					<span className="text-foreground/70">{event.verdict.reason}</span>
				</div>
			);
		case "recurse":
			return (
				<div className="text-sm">
					<span className="font-medium">[critic]</span> recursing on{" "}
					{event.subquestionId} {"->"} "{event.followUpQuestion}" ( depth{" "}
					{event.newDepth})
				</div>
			);
		case "budget_hit":
			return (
				<div className="text-amber-600 text-sm">
					<span className="font-medium">[budget]</span> hit cap ({event.reason})
					— synthesizing with what we have
				</div>
			);
		case "synthesis_fallback":
			return (
				<div className="text-amber-600 text-sm">
					<span className="font-medium">[synthesizer]</span> synthesis failed (
					{event.error}) — using assembled fallback report
				</div>
			);
		case "report_complete":
			return (
				<div className="text-sm">
					<span className="font-medium">[synthesizer]</span> report complete:{" "}
					{event.report.title}
				</div>
			);
	}
}

export default function ResearchPanel() {
	const [query, setQuery] = useState("");
	const [running, setRunning] = useState(false);
	const [events, setEvents] = useState<AgentEvent[]>([]);
	const [report, setReport] = useState<Report | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [stats, setStats] = useState<{
		searches?: number;
		llmCalls?: number;
		recursions?: number;
		durationMs?: number;
	} | null>(null);

	async function startResearch() {
		if (!query.trim() || running) return;
		setRunning(true);
		setEvents([]);
		setReport(null);
		setError(null);
		setStats(null);

		try {
			const res = await fetch(`${SERVER_URL}/api/research`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query }),
			});
			if (!res.ok || !res.body) {
				throw new Error(`HTTP ${res.status}`);
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				// SSE: messages separated by blank lines.
				const parts = buffer.split("\n\n");
				buffer = parts.pop() ?? "";
				for (const part of parts) {
					const line = part.split("\n").find((l) => l.startsWith("data: "));
					if (!line) continue;
					const data = JSON.parse(line.slice(6)) as TimelineEntry;
					if (data.kind === "event") {
						setEvents((prev) => [...prev, data.event]);
					} else if (data.kind === "done") {
						setReport(data.report);
						setStats(data.stats as typeof stats);
					}
				}
			}
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setRunning(false);
		}
	}

	return (
		<div className="container mx-auto max-w-4xl px-4 py-6">
			<Card>
				<CardHeader>
					<CardTitle>Recursive Research Agent</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<form
						className="flex gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							void startResearch();
						}}
					>
						<div className="grid flex-1 gap-1.5">
							<Label htmlFor="query">Research question</Label>
							<Input
								id="query"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="e.g. Why is the sky blue?"
								disabled={running}
							/>
						</div>
						<Button
							type="submit"
							disabled={running || !query.trim()}
							className="mt-5"
						>
							{running ? <Loader2 className="animate-spin" /> : <Play />}
							{running ? "Researching…" : "Research"}
						</Button>
					</form>

					{error && <p className="text-red-600 text-sm">Error: {error}</p>}
					{stats && (
						<p className="text-foreground/60 text-xs">
							Done in {stats.durationMs}ms | {stats.searches} searches |{" "}
							{stats.llmCalls} LLM calls | {stats.recursions} recursions
						</p>
					)}
				</CardContent>
			</Card>

			{events.length > 0 && (
				<Card className="mt-4">
					<CardHeader>
						<CardTitle className="text-base">Agent trace</CardTitle>
					</CardHeader>
					<CardContent className="space-y-1.5 font-mono text-xs">
						{events.map((e, i) => (
							<EventLine key={i} event={e} />
						))}
					</CardContent>
				</Card>
			)}

			{report && (
				<Card className="mt-4">
					<CardHeader>
						<CardTitle>{report.title}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<p className="text-sm leading-relaxed">{report.summary}</p>
						{report.sections.map((s) => (
							<div key={s.subquestionId} className="space-y-1">
								<h3 className="font-semibold text-sm">{s.question}</h3>
								<p className="text-foreground/80 text-sm leading-relaxed">
									{s.answer}
								</p>
							</div>
						))}
						{report.citations.length > 0 && (
							<div className="space-y-1 border-t pt-3">
								<h4 className="font-semibold text-sm">Sources</h4>
								<ul className="list-inside list-disc text-foreground/70 text-xs">
									{report.citations.map((c) => (
										<li key={c.id}>
											<a
												href={c.url}
												target="_blank"
												rel="noreferrer"
												className="underline"
											>
												{c.title}
											</a>{" "}
											— {c.url}
										</li>
									))}
								</ul>
							</div>
						)}
					</CardContent>
				</Card>
			)}
		</div>
	);
}
