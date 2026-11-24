import { createServer, type Server } from "node:http";
import { HOOK_HOST, HOOK_PORT } from "../config";
import type { HookEvent, SessionStore } from "../state/sessions";

/** Largest request body that is parsed. Larger bodies are discarded. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

type Log = { info(message: string): void; error(message: string): void };

/** Current state of the hook receiver, shared with the connection display. */
export const hookServerStatus: { listening: boolean; error: string | undefined } = { listening: false, error: undefined };

/**
 * Starts an HTTP server on the loopback interface that receives Claude Code hook events
 * as JSON `POST /event` requests, and status line updates as JSON `POST /statusline` requests,
 * and applies them to the session store.
 * Every request is answered immediately with an empty JSON object, so hooks never delay Claude Code.
 */
export function startHookServer(store: SessionStore, log: Log): Server {
	const server = createServer((req, res) => {
		const respond = (status: number): void => {
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end("{}");
		};

		if (req.method !== "POST" || (req.url !== "/event" && req.url !== "/statusline")) {
			respond(404);
			return;
		}

		const chunks: Buffer[] = [];
		let size = 0;
		let discard = false;

		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				discard = true;
				chunks.length = 0;
				return;
			}
			if (!discard) {
				chunks.push(chunk);
			}
		});

		req.on("end", () => {
			respond(200);
			if (discard) {
				return;
			}
			try {
				const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				if (req.url === "/statusline") {
					store.handleStatus(body);
				} else {
					store.handle(body as HookEvent);
				}
			} catch (err) {
				log.error(`Ignored malformed hook event: ${err instanceof Error ? err.message : String(err)}`);
			}
		});

		req.on("error", () => respond(400));
	});

	server.on("error", (err: NodeJS.ErrnoException) => {
		hookServerStatus.listening = false;
		hookServerStatus.error = err.code === "EADDRINUSE" ? "port in use" : err.message;
		log.error(
			err.code === "EADDRINUSE"
				? `Hook server could not start: port ${HOOK_PORT} is already in use`
				: `Hook server error: ${err.message}`,
		);
	});

	server.listen(HOOK_PORT, HOOK_HOST, () => {
		hookServerStatus.listening = true;
		hookServerStatus.error = undefined;
		log.info(`Hook server listening on http://${HOOK_HOST}:${HOOK_PORT}/event`);
	});
	// The server must not keep the process alive, so the plugin exits when Stream Deck disconnects.
	server.unref();
	return server;
}
