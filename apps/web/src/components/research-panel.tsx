"use client";

import type {
	AgentEvent,
	Report,
	Plan as ResearchPlan,
	RunStats,
	Verdict,
} from "@oncemore/agent";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from "@oncemore/ui/components/ai-elements/conversation";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "@oncemore/ui/components/ai-elements/message";
import {
	Plan,
	PlanContent,
	PlanDescription,
	PlanHeader,
	PlanTitle,
	PlanTrigger,
} from "@oncemore/ui/components/ai-elements/plan";
import {
	PromptInput,
	PromptInputFooter,
	PromptInputProvider,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputController,
} from "@oncemore/ui/components/ai-elements/prompt-input";
import { Shimmer } from "@oncemore/ui/components/ai-elements/shimmer";
import {
	Source,
	Sources,
	SourcesContent,
	SourcesTrigger,
} from "@oncemore/ui/components/ai-elements/sources";
import {
	Suggestion,
	Suggestions,
} from "@oncemore/ui/components/ai-elements/suggestion";
import {
	Tool,
	ToolContent,
	ToolHeader,
} from "@oncemore/ui/components/ai-elements/tool";
import { Badge } from "@oncemore/ui/components/badge";
import { TelescopeIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { getProvider } from "@/lib/config-store";

const SERVER_URL =
	process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";

const SUGGESTIONS = [
	"Why is the sky blue?",
	"How do large language models work?",
	"What causes the northern lights?",
	"Is intermittent fasting actually effective?",
];

type TimelineEntry =
	| { kind: "event"; event: AgentEvent }
	| { kind: "done"; report: Report; stats: RunStats };

type SearchState = {
	key: string;
	subquestionId: string;
	query: string;
	depth: number;
	status: "running" | "complete" | "failed";
	sourceCount?: number;
	durationMs?: number;
	error?: string;
	verdict?: Verdict;
	verdictModel?: string;
	model?: string;
	answer?: string;
	followUp?: string;
};

function VerdictBadge({ decision }: { decision: Verdict["decision"] }) {
	switch (decision) {
		case "accept":
			return (
				<Badge
					className="bg-green-500/15 text-green-600 dark:text-green-400"
					variant="secondary"
				>
					accept
				</Badge>
			);
		case "recurse":
			return (
				<Badge
					className="bg-amber-500/15 text-amber-600 dark:text-amber-400"
					variant="secondary"
				>
					recurse
				</Badge>
			);
		case "fail":
			return (
				<Badge
					className="bg-red-500/15 text-red-600 dark:text-red-400"
					variant="secondary"
				>
					fail
				</Badge>
			);
	}
}

/** Patch the most recent search entry for a subquestion, if any. */
function patchLatestSearch(
	searches: SearchState[],
	subquestionId: string,
	patch: Partial<SearchState>,
): SearchState[] {
	for (let i = searches.length - 1; i >= 0; i--) {
		if (searches[i].subquestionId === subquestionId) {
			return searches.map((s, j) => (j === i ? { ...s, ...patch } : s));
		}
	}
	return searches;
}

function ModelLine({ model }: { model: string }) {
	return (
		<p className="text-[11px] text-muted-foreground/70">
			Model: <span className="font-mono">{model}</span>
		</p>
	);
}

function SearchTool({ search }: { search: SearchState }) {
	const state =
		search.status === "running"
			? "input-available"
			: search.status === "failed"
				? "output-error"
				: "output-available";

	return (
		<Tool>
			<ToolHeader state={state} title={search.query} type="tool-web_search" />
			<ToolContent>
				<div className="space-y-2 text-muted-foreground text-xs">
					{search.status === "running" && <p>Searching the web…</p>}
					{search.status === "complete" && (
						<p>
							depth {search.depth} · {search.sourceCount} sources ·{" "}
							{((search.durationMs ?? 0) / 1000).toFixed(1)}s
						</p>
					)}
					{search.answer && (
						<div className="space-y-1 rounded-none border bg-muted/20 p-2 text-foreground">
							<p className="line-clamp-6 whitespace-pre-wrap text-xs leading-relaxed">
								{search.answer}
							</p>
							{search.model && <ModelLine model={search.model} />}
						</div>
					)}
					{!search.answer && search.model && <ModelLine model={search.model} />}
					{search.error && <p className="text-destructive">{search.error}</p>}
					{search.verdict && (
						<div className="space-y-1">
							<p className="flex items-center gap-1.5">
								<VerdictBadge decision={search.verdict.decision} />
								<span>{search.verdict.reason}</span>
							</p>
							{search.verdictModel && <ModelLine model={search.verdictModel} />}
						</div>
					)}
					{search.followUp && <p>Following up: “{search.followUp}”</p>}
				</div>
			</ToolContent>
		</Tool>
	);
}

function ResearchWorkspace() {
	const controller = usePromptInputController();
	const [running, setRunning] = useState(false);
	const [runId, setRunId] = useState(0);
	const [question, setQuestion] = useState<string | null>(null);
	const [plan, setPlan] = useState<ResearchPlan | null>(null);
	const [plannerModel, setPlannerModel] = useState<string | null>(null);
	const [searches, setSearches] = useState<SearchState[]>([]);
	const [warnings, setWarnings] = useState<string[]>([]);
	const [report, setReport] = useState<Report | null>(null);
	const [reportModel, setReportModel] = useState<string | null>(null);
	const [stats, setStats] = useState<RunStats | null>(null);
	const [error, setError] = useState<string | null>(null);

	const reportMarkdown = useMemo(() => {
		if (!report) {
			return "";
		}
		return [
			`# ${report.title}`,
			report.summary,
			...report.sections.map((s) => `### ${s.question}\n\n${s.answer}`),
		].join("\n\n");
	}, [report]);

	function handleEvent(event: AgentEvent) {
		switch (event.type) {
			case "plan_created":
				setPlan(event.plan);
				setPlannerModel(event.model);
				break;
			case "result_produced":
				setSearches((prev) =>
					patchLatestSearch(prev, event.result.subquestionId, {
						answer: event.result.answer,
						model: event.result.model,
					}),
				);
				break;
			case "search_started":
				setSearches((prev) => [
					...prev,
					{
						key: `search-${runId}-${prev.length}`,
						subquestionId: event.subquestionId,
						query: event.query,
						depth: event.depth,
						status: "running",
					},
				]);
				break;
			case "search_completed":
				setSearches((prev) =>
					patchLatestSearch(prev, event.subquestionId, {
						status: "complete",
						sourceCount: event.sourceCount,
						durationMs: event.durationMs,
					}),
				);
				break;
			case "subquestion_failed":
				setSearches((prev) => {
					const patched = patchLatestSearch(prev, event.subquestionId, {
						status: "failed",
						error: event.error,
					});
					if (patched !== prev) {
						return patched;
					}
					return [
						...prev,
						{
							key: `search-${runId}-${prev.length}`,
							subquestionId: event.subquestionId,
							query: event.question,
							depth: event.depth,
							status: "failed",
							error: event.error,
						},
					];
				});
				break;
			case "verdict":
				setSearches((prev) =>
					patchLatestSearch(prev, event.subquestionId, {
						verdict: event.verdict,
						verdictModel: event.model,
					}),
				);
				break;
			case "recurse":
				setSearches((prev) =>
					patchLatestSearch(prev, event.subquestionId, {
						followUp: event.followUpQuestion,
					}),
				);
				break;
			case "budget_hit":
				setWarnings((prev) => [
					...prev,
					`Search budget cap hit (${event.reason}) — synthesizing with what we have`,
				]);
				break;
			case "synthesis_fallback":
				setWarnings((prev) => [
					...prev,
					`Synthesis failed (${event.error}) — using assembled fallback report`,
				]);
				break;
			case "report_complete":
				setReport(event.report);
				setReportModel(event.model ?? event.report.model ?? null);
				setStats(event.stats);
				break;
			default:
				break;
		}
	}

	async function startResearch(query: string) {
		if (!query.trim() || running) {
			return;
		}
		setRunId((n) => n + 1);
		setQuestion(query);
		setRunning(true);
		setPlan(null);
		setPlannerModel(null);
		setSearches([]);
		setWarnings([]);
		setReport(null);
		setReportModel(null);
		setStats(null);
		setError(null);

		try {
			const provider = getProvider();
			const res = await fetch(`${SERVER_URL}/api/research`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query, config: { provider } }),
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
						handleEvent(data.event);
					} else if (data.kind === "done") {
						setReport(data.report);
						if (data.report.model) setReportModel(data.report.model);
						setStats(data.stats);
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
		<div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
			<Conversation className="min-h-0 flex-1">
				<ConversationContent className="mx-auto w-full max-w-3xl gap-4">
					{question === null ? (
						<ConversationEmptyState>
							<div className="flex flex-col items-center gap-4 text-center">
								<div className="rounded-full bg-muted p-3 text-muted-foreground">
									<TelescopeIcon className="size-8" />
								</div>
								<div className="space-y-1">
									<h3 className="font-medium text-lg">
										Recursive research agent
									</h3>
									<p className="max-w-md text-muted-foreground text-sm">
										Ask anything — the agent plans sub-questions, searches the
										web, critiques its own findings, and recurses until the
										answers hold up.
									</p>
								</div>
								<Suggestions className="w-full justify-center">
									{SUGGESTIONS.map((suggestion) => (
										<Suggestion
											key={suggestion}
											onClick={() => void startResearch(suggestion)}
											suggestion={suggestion}
										/>
									))}
								</Suggestions>
							</div>
						</ConversationEmptyState>
					) : (
						<>
							<Message from="user">
								<MessageContent>{question}</MessageContent>
							</Message>

							{running && !plan && (
								<Shimmer className="text-muted-foreground text-sm">
									Planning research…
								</Shimmer>
							)}

							{plan && (
								<Plan defaultOpen>
									<PlanHeader>
										<div className="space-y-1">
											<PlanTitle>Research plan</PlanTitle>
											<PlanDescription>
												{`${plan.subquestions.length} sub-questions to investigate`}
											</PlanDescription>
										</div>
										<PlanTrigger />
									</PlanHeader>
									<PlanContent>
										<ul className="space-y-2">
											{plan.subquestions.map((sq) => (
												<li className="flex gap-2 text-sm" key={sq.id}>
													<span className="font-mono text-muted-foreground text-xs">
														{sq.id}
													</span>
													<span>{sq.question}</span>
												</li>
											))}
										</ul>
										{plannerModel && (
											<div className="pt-2">
												<ModelLine model={plannerModel} />
											</div>
										)}
									</PlanContent>
								</Plan>
							)}

							{searches.map((search) => (
								<SearchTool key={search.key} search={search} />
							))}

							{warnings.map((warning, i) => (
								<div
									className="flex items-start gap-2 text-amber-600 text-xs dark:text-amber-400"
									key={`warning-${i}`}
								>
									<TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
									<span>{warning}</span>
								</div>
							))}

							{error && (
								<p className="text-destructive text-sm">Error: {error}</p>
							)}

							{report && (
								<Message from="assistant">
									<MessageContent className="w-full">
										<Sources>
											<SourcesTrigger count={report.citations.length} />
											<SourcesContent>
												{report.citations.map((citation) => (
													<Source
														className="hover:underline"
														href={citation.url}
														key={citation.id}
														title={citation.title}
													/>
												))}
											</SourcesContent>
										</Sources>
										<MessageResponse>{reportMarkdown}</MessageResponse>
										{(reportModel ?? report.model) && (
											<ModelLine
												model={(reportModel ?? report.model) as string}
											/>
										)}
										{stats && (
											<div className="flex flex-wrap gap-1.5">
												<Badge variant="outline">
													{stats.searches} searches
												</Badge>
												<Badge variant="outline">
													{stats.llmCalls} LLM calls
												</Badge>
												<Badge variant="outline">
													{stats.recursions} recursions
												</Badge>
												<Badge variant="outline">
													{(stats.durationMs / 1000).toFixed(1)}s
												</Badge>
											</div>
										)}
									</MessageContent>
								</Message>
							)}
						</>
					)}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			<div className="border-t bg-background">
				<div className="mx-auto w-full max-w-3xl p-3">
					<PromptInput
						onSubmit={(message) => {
							void startResearch(message.text);
						}}
					>
						<PromptInputTextarea placeholder="Ask a research question…" />
						<PromptInputFooter>
							<PromptInputTools>
								<span className="text-muted-foreground text-xs">
									Enter to research · Shift+Enter for a new line
								</span>
							</PromptInputTools>
							<PromptInputSubmit
								disabled={running || !controller.textInput.value.trim()}
								status={running ? "submitted" : "ready"}
							/>
						</PromptInputFooter>
					</PromptInput>
				</div>
			</div>
		</div>
	);
}

export default function ResearchPanel() {
	return (
		<PromptInputProvider>
			<ResearchWorkspace />
		</PromptInputProvider>
	);
}
