import { request, type Server } from "node:http";
import net, { type AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hookServerStatus, startHookServer } from "../../src/server/hook-server";
import { SessionStore } from "../../src/state/sessions";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

type Reply = { status: number | undefined; body: string; contentType: string | string[] | undefined };

let store: SessionStore;
let log: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
let servers: Server[];

/** Starts a server on an ephemeral loopback port and resolves once it is listening. */
async function start(): Promise<{ server: Server; port: number }> {
	const server = startHookServer(store, log, 0, "127.0.0.1");
	servers.push(server);
	await new Promise<void>((done) => server.once("listening", done));
	return { server, port: (server.address() as AddressInfo).port };
}

function collect(resolve: (reply: Reply) => void): (res: import("node:http").IncomingMessage) => void {
	return (res) => {
		const chunks: Buffer[] = [];
		res.on("data", (chunk: Buffer) => chunks.push(chunk));
		res.on("end", () =>
			resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8"), contentType: res.headers["content-type"] }),
		);
	};
}

/** Sends one request with the given body in one write and collects the reply. */
function send(port: number, method: string, path: string, body?: string | Buffer): Promise<Reply> {
	return new Promise((resolve, reject) => {
		const headers: Record<string, string | number> = {};
		if (body !== undefined) {
			headers["Content-Length"] = Buffer.byteLength(body);
		}
		const req = request({ host: "127.0.0.1", port, method, path, headers, agent: false }, collect(resolve));
		req.on("error", reject);
		req.end(body);
	});
}

/** Sends a body as separate writes with a pause after each and collects the reply. */
function sendChunked(port: number, path: string, parts: Buffer[]): Promise<Reply> {
	return new Promise((resolve, reject) => {
		const req = request({ host: "127.0.0.1", port, method: "POST", path, agent: false }, collect(resolve));
		req.on("error", reject);
		void (async () => {
			for (const part of parts) {
				req.write(part);
				await new Promise((done) => setTimeout(done, 25));
			}
			req.end();
		})();
	});
}

function hookEvent(fields: Record<string, unknown>): string {
	return JSON.stringify({ hook_event_name: "UserPromptSubmit", ...fields });
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error("condition not met in time");
		}
		await new Promise((done) => setTimeout(done, 5));
	}
}

const settle = (ms = 60): Promise<void> => new Promise((done) => setTimeout(done, ms));

function expectStoreUntouched(): void {
	expect(store.sessions()).toEqual([]);
	expect(store.lastEvent()).toBeUndefined();
	expect(store.lastStatus()).toBeUndefined();
}

beforeEach(() => {
	store = new SessionStore();
	log = { info: vi.fn(), error: vi.fn() };
	servers = [];
});

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		servers.map(
			(server) =>
				new Promise<void>((done) => {
					if (!server.listening) {
						done();
						return;
					}
					server.close(() => done());
					server.closeAllConnections();
				}),
		),
	);
	hookServerStatus.listening = false;
	hookServerStatus.error = undefined;
});

describe("startup", () => {
	it("reports listening with the bound port and no error", async () => {
		const { port } = await start();
		expect(hookServerStatus.listening).toBe(true);
		expect(hookServerStatus.error).toBeUndefined();
		expect(port).toBeGreaterThan(0);
		expect(log.info).toHaveBeenCalledTimes(1);
		expect(log.info).toHaveBeenCalledWith(`Hook server listening on http://127.0.0.1:${port}/event`);
		expect(log.error).not.toHaveBeenCalled();
	});

	it("binds to the IPv4 loopback address only", async () => {
		const { server } = await start();
		const address = server.address() as AddressInfo;
		expect(address.address).toBe("127.0.0.1");
		expect(address.family).toBe("IPv4");
	});

	it("does not keep the process alive", async () => {
		const unref = vi.spyOn(net.Server.prototype, "unref");
		const { server } = await start();
		expect(unref).toHaveBeenCalled();
		expect(unref.mock.contexts).toContain(server);
	});
});

describe("routing", () => {
	it("answers POST /event with an empty JSON object and applies the event", async () => {
		const { port } = await start();
		const reply = await send(port, "POST", "/event", hookEvent({ session_id: "s1", cwd: "C:\\work\\proj" }));
		expect(reply.status).toBe(200);
		expect(reply.body).toBe("{}");
		expect(reply.contentType).toBe("application/json");
		await waitFor(() => store.sessions().length === 1);
		const [session] = store.sessions();
		expect(session?.id).toBe("s1");
		expect(session?.state).toBe("working");
		expect(session?.project).toBe("proj");
		expect(store.summary().overall).toBe("working");
		expect(store.lastEvent()).toBeDefined();
		expect(store.lastStatus()).toBeUndefined();
	});

	it("answers POST /statusline with an empty JSON object and applies the status data", async () => {
		const { port } = await start();
		const payload = {
			session_id: "s2",
			model: { id: "claude-x", display_name: "Model X" },
			context_window: { used_percentage: 42, total_input_tokens: 84000, context_window_size: 200000 },
		};
		const reply = await send(port, "POST", "/statusline", JSON.stringify(payload));
		expect(reply.status).toBe(200);
		expect(reply.body).toBe("{}");
		expect(reply.contentType).toBe("application/json");
		await waitFor(() => store.latestContext() !== undefined);
		const session = store.latestContext();
		expect(session?.id).toBe("s2");
		expect(session?.model).toEqual({ id: "claude-x", name: "Model X" });
		expect(session?.contextPercent).toBe(42);
		expect(session?.contextTokens).toBe(84000);
		expect(session?.contextSize).toBe(200000);
		expect(store.lastStatus()).toBeDefined();
		expect(store.lastEvent()).toBeUndefined();
	});

	it("emits status with the raw payload for /statusline", async () => {
		const { port } = await start();
		const seen: unknown[] = [];
		store.on("status", (data) => seen.push(data));
		const payload = { session_id: "s3", rate_limits: { five_hour: 1 } };
		await send(port, "POST", "/statusline", JSON.stringify(payload));
		await waitFor(() => seen.length === 1);
		expect(seen[0]).toEqual(payload);
	});

	const rejected: Array<[string, string]> = [
		["GET", "/event"],
		["GET", "/statusline"],
		["PUT", "/event"],
		["DELETE", "/event"],
		["PUT", "/statusline"],
		["DELETE", "/statusline"],
		["POST", "/other"],
		["POST", "/"],
		["POST", "/event/"],
		["POST", "/statusline/"],
		["POST", "/event?x=1"],
		["POST", "/statusline?x=1"],
		["POST", "/EVENT"],
	];

	it.each(rejected)("answers %s %s with 404 and leaves the store unchanged", async (method, path) => {
		const { port } = await start();
		const reply = await send(port, method, path, hookEvent({ session_id: "nope" }));
		expect(reply.status).toBe(404);
		expect(reply.body).toBe("{}");
		expect(reply.contentType).toBe("application/json");
		await settle();
		expectStoreUntouched();
		expect(log.error).not.toHaveBeenCalled();
	});

	it("answers HEAD with 404 and no body", async () => {
		const { port } = await start();
		const reply = await send(port, "HEAD", "/event");
		expect(reply.status).toBe(404);
		expect(reply.body).toBe("");
		expectStoreUntouched();
	});

	it("answers 200 on each valid path even when the body is malformed", async () => {
		const { port } = await start();
		for (const path of ["/event", "/statusline"]) {
			const reply = await send(port, "POST", path, "{not json");
			expect(reply.status).toBe(200);
			expect(reply.body).toBe("{}");
		}
	});
});

describe("bad bodies", () => {
	it.each([
		["invalid JSON", "{not json"],
		["an empty body", ""],
		["truncated JSON", '{"hook_event_name":"UserPromptSubmit","session_id":"t'],
		["JSON null", "null"],
	])("answers 200, logs, and leaves the store unchanged for %s", async (_name, body) => {
		const { port } = await start();
		const reply = await send(port, "POST", "/event", body);
		expect(reply.status).toBe(200);
		expect(reply.body).toBe("{}");
		await waitFor(() => log.error.mock.calls.length === 1);
		expect(String(log.error.mock.calls[0]?.[0])).toMatch(/^Ignored malformed hook event: ./);
		expectStoreUntouched();
	});

	it("logs a TypeError message for JSON null because the store reads a property of null", async () => {
		const { port } = await start();
		await send(port, "POST", "/event", "null");
		await waitFor(() => log.error.mock.calls.length === 1);
		expect(String(log.error.mock.calls[0]?.[0])).toContain("null");
	});

	it.each([
		["a number", "7"],
		["a string", '"text"'],
		["an array", "[]"],
		["an object without ids", "{}"],
	])("answers 200 and ignores %s without logging", async (_name, body) => {
		const { port } = await start();
		const reply = await send(port, "POST", "/event", body);
		expect(reply.status).toBe(200);
		expect(reply.body).toBe("{}");
		await settle();
		expect(log.error).not.toHaveBeenCalled();
		expectStoreUntouched();
	});

	it("logs an invalid JSON body sent to /statusline", async () => {
		const { port } = await start();
		const reply = await send(port, "POST", "/statusline", "nope");
		expect(reply.status).toBe(200);
		await waitFor(() => log.error.mock.calls.length === 1);
		expect(String(log.error.mock.calls[0]?.[0])).toMatch(/^Ignored malformed hook event: /);
		expectStoreUntouched();
	});

	it.each([
		["JSON null", "null"],
		["a number", "7"],
		["an array", "[]"],
	])("ignores %s sent to /statusline without logging", async (_name, body) => {
		const { port } = await start();
		const reply = await send(port, "POST", "/statusline", body);
		expect(reply.status).toBe(200);
		await settle();
		expect(log.error).not.toHaveBeenCalled();
		expectStoreUntouched();
	});

	it("keeps serving after a malformed body", async () => {
		const { port } = await start();
		await send(port, "POST", "/event", "{bad");
		await send(port, "POST", "/event", hookEvent({ session_id: "after" }));
		await waitFor(() => store.sessions().length === 1);
		expect(store.sessions()[0]?.id).toBe("after");
	});
});

describe("body handling", () => {
	function padded(sessionId: string, totalBytes: number): Buffer {
		const base = `{"hook_event_name":"UserPromptSubmit","session_id":"${sessionId}","pad":""}`;
		const body = Buffer.from(base.replace('"pad":""', `"pad":"${"x".repeat(totalBytes - base.length)}"`));
		expect(body.length).toBe(totalBytes);
		return body;
	}

	it("assembles a body split across several writes", async () => {
		const { port } = await start();
		const body = Buffer.from(hookEvent({ session_id: "split", cwd: "/a/b/split-proj" }));
		const parts = [body.subarray(0, 10), body.subarray(10, 25), body.subarray(25, 40), body.subarray(40)];
		const reply = await sendChunked(port, "/event", parts);
		expect(reply.status).toBe(200);
		await waitFor(() => store.sessions().length === 1);
		expect(store.sessions()[0]).toMatchObject({ id: "split", project: "split-proj" });
	});

	it("parses multi-byte UTF-8 characters split across chunk boundaries", async () => {
		const { port } = await start();
		const command = "echo héllo 日本語 😀 done";
		const body = Buffer.from(
			JSON.stringify({ hook_event_name: "PermissionRequest", session_id: "utf8", tool_name: "Bash", tool_input: { command } }),
		);
		const parts: Buffer[] = [];
		let from = 0;
		for (const character of ["é", "日", "😀"]) {
			const cut = body.indexOf(Buffer.from(character)) + 1;
			parts.push(body.subarray(from, cut));
			from = cut;
		}
		parts.push(body.subarray(from));
		expect(Buffer.concat(parts).equals(body)).toBe(true);
		const reply = await sendChunked(port, "/event", parts);
		expect(reply.status).toBe(200);
		await waitFor(() => store.sessions().length === 1);
		expect(store.sessions()[0]?.pending).toEqual({ kind: "permission", tool: "Bash", detail: command });
		expect(log.error).not.toHaveBeenCalled();
	});

	it("applies a body just under 8 MiB", async () => {
		const { port } = await start();
		const reply = await send(port, "POST", "/event", padded("big", MAX_BODY_BYTES - 10));
		expect(reply.status).toBe(200);
		await waitFor(() => store.sessions().length === 1);
		expect(store.sessions()[0]?.id).toBe("big");
	});

	it("applies a body of exactly 8 MiB", async () => {
		const { port } = await start();
		await send(port, "POST", "/event", padded("exact", MAX_BODY_BYTES));
		await waitFor(() => store.sessions().length === 1);
		expect(store.sessions()[0]?.id).toBe("exact");
	});

	it("answers 200 but does not apply a body over 8 MiB, and keeps serving", async () => {
		const { port } = await start();
		const reply = await send(port, "POST", "/event", padded("huge", MAX_BODY_BYTES + 1));
		expect(reply.status).toBe(200);
		expect(reply.body).toBe("{}");
		await settle();
		expectStoreUntouched();
		expect(log.error).not.toHaveBeenCalled();

		await send(port, "POST", "/event", hookEvent({ session_id: "normal" }));
		await waitFor(() => store.sessions().length === 1);
		expect(store.sessions()[0]?.id).toBe("normal");
	});

	it("discards an oversized body that arrives in several chunks", async () => {
		const { port } = await start();
		const body = padded("huge-chunked", MAX_BODY_BYTES + 1000);
		const third = Math.floor(body.length / 3);
		const parts = [body.subarray(0, third), body.subarray(third, third * 2), body.subarray(third * 2)];
		const reply = await sendChunked(port, "/event", parts);
		expect(reply.status).toBe(200);
		await settle();
		expectStoreUntouched();
	});
});

describe("concurrency and clients", () => {
	it("applies 20 simultaneous requests with distinct session ids", async () => {
		const { port } = await start();
		const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
		const replies = await Promise.all(ids.map((id) => send(port, "POST", "/event", hookEvent({ session_id: id }))));
		expect(replies.every((reply) => reply.status === 200 && reply.body === "{}")).toBe(true);
		await waitFor(() => store.sessions().length === 20);
		expect(store.sessions().map((s) => s.id).sort()).toEqual([...ids].sort());
		expect(store.summary().working).toBe(20);
	});

	it("survives a client that aborts mid-body", async () => {
		const { port } = await start();
		const full = hookEvent({ session_id: "aborted" });
		await new Promise<void>((done) => {
			const req = request({ host: "127.0.0.1", port, method: "POST", path: "/event", headers: { "Content-Length": full.length }, agent: false });
			req.on("error", () => undefined);
			req.on("close", () => done());
			req.write(full.slice(0, 15));
			setTimeout(() => req.destroy(), 40);
		});
		await settle();
		expectStoreUntouched();

		const reply = await send(port, "POST", "/event", hookEvent({ session_id: "next" }));
		expect(reply.status).toBe(200);
		await waitFor(() => store.sessions().length === 1);
		expect(store.sessions()[0]?.id).toBe("next");
	});
});

describe("errors", () => {
	it("reports a port already in use and recovers on a later successful start", async () => {
		const { port } = await start();
		log.info.mockClear();

		const second = startHookServer(store, log, port, "127.0.0.1");
		servers.push(second);
		await new Promise<void>((done) => second.once("error", () => done()));
		expect(hookServerStatus.listening).toBe(false);
		expect(hookServerStatus.error).toBe("port in use");
		expect(log.error).toHaveBeenCalledWith(`Hook server could not start: port ${port} is already in use`);
		expect(log.info).not.toHaveBeenCalled();

		await start();
		expect(hookServerStatus.listening).toBe(true);
		expect(hookServerStatus.error).toBeUndefined();
	});

	it("reports other listen errors with their message", async () => {
		const server = startHookServer(store, log, 0, "203.0.113.1");
		servers.push(server);
		const error = await new Promise<NodeJS.ErrnoException>((done) => server.once("error", done));
		expect(error.code).not.toBe("EADDRINUSE");
		expect(hookServerStatus.listening).toBe(false);
		expect(hookServerStatus.error).toBe(error.message);
		expect(log.error).toHaveBeenCalledWith(`Hook server error: ${error.message}`);
		expect(String(log.error.mock.calls[0]?.[0])).toMatch(/^Hook server error:/);
	});
});
