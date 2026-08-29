// CLI entry: bun run agent -- "your research query"
// Runs the recursive research agent headlessly with console logging.
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ConsoleLogger, runResearch } from "@oncemore/agent";

type Flags = {
	maxDepth?: number;
	maxSearches?: number;
	out?: string;
};

function parseArgs(argv: string[]): { query: string; flags: Flags } {
	const flags: Flags = {};
	const queryParts: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg) continue;
		const value = argv[i + 1];
		if (arg === "--max-depth" && value) {
			flags.maxDepth = Number(value);
			i++;
		} else if (arg === "--max-searches" && value) {
			flags.maxSearches = Number(value);
			i++;
		} else if (arg === "--out" && value) {
			flags.out = value;
			i++;
		} else if (arg.startsWith("--")) {
			// ignore unknown flags
		} else {
			queryParts.push(arg);
		}
	}
	return { query: queryParts.join(" ").trim(), flags };
}

async function main() {
	const { query, flags } = parseArgs(process.argv.slice(2));

	if (!query) {
		console.error(
			'Usage: bun run agent -- "your research question"\n' +
				"Flags: --max-depth <n>  --max-searches <n>  --out <file.json>",
		);
		process.exit(1);
	}

	const config: Record<string, unknown> = {};
	if (flags.maxDepth !== undefined) config.maxDepth = flags.maxDepth;
	if (flags.maxSearches !== undefined)
		config.maxTotalSearches = flags.maxSearches;

	const logger = new ConsoleLogger();
	const events: unknown[] = [];

	const { report, stats, plan, results } = await runResearch({
		query,
		config,
		callbacks: {
			logger,
			onEvent: (e) => events.push(e),
		},
	});

	// Pretty-print the final report.
	console.log(`\n${"─".repeat(60)}`);
	console.log(`# ${report.title}`);
	console.log(`\n${report.summary}\n`);
	for (const section of report.sections) {
		console.log(`## ${section.question}`);
		console.log(`\n${section.answer}\n`);
	}
	if (report.citations.length > 0) {
		console.log("### Sources");
		for (const c of report.citations) {
			console.log(`- [${c.id}] ${c.title} — ${c.url}`);
		}
	}
	console.log(`\n${"─".repeat(60)}`);
	console.log(
		`Done in ${stats.durationMs}ms | ${stats.searches} searches | ${stats.llmCalls} LLM calls | ${stats.recursions} recursions`,
	);

	// Write a trace file so decisions are reviewable without re-running.
	const outPath = flags.out ?? `traces/${Date.now()}.json`;
	const dir = resolve(outPath).includes("/")
		? resolve(outPath).split("/").slice(0, -1).join("/")
		: ".";
	await mkdir(dir, { recursive: true });
	await writeFile(
		resolve(outPath),
		JSON.stringify(
			{ query, config, plan, results, stats, events, report },
			null,
			2,
		),
	);
	console.log(`Trace written to ${outPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
