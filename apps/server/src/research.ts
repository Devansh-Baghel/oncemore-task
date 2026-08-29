// SSE endpoint: POST /api/research streams AgentEvents + final report as JSON lines.
import { runResearch } from "@oncemore/agent";
import type { Request, Response } from "express";

function sendEvent(res: Response, data: unknown) {
	res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Handles a research run and streams events over SSE. The client can stop
 * the run by closing the connection (request aborted).
 */
export async function handleResearch(req: Request, res: Response) {
	const body = req.body as { query?: unknown; config?: unknown };
	const { query, config } = body ?? {};
	if (typeof query !== "string" || query.trim().length === 0) {
		res.status(400).json({ error: "query is required" });
		return;
	}

	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache, no-transform");
	res.setHeader("Connection", "keep-alive");
	res.flushHeaders();

	// Heartbeat to keep the connection alive on long runs.
	const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

	let closed = false;
	res.on("close", () => {
		closed = true;
		clearInterval(heartbeat);
	});

	try {
		const result = await runResearch({
			query,
			config: config ?? {},
			callbacks: {
				onEvent: (event) => {
					if (closed) return;
					sendEvent(res, { kind: "event", event });
				},
			},
		});
		if (!closed) {
			sendEvent(res, { kind: "done", ...result });
			res.end();
		}
	} catch (err) {
		if (!closed) {
			sendEvent(res, { kind: "error", error: (err as Error).message });
			res.end();
		}
	}
}
