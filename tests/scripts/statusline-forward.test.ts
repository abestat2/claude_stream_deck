import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../com.claudedeck.controls.sdPlugin/scripts/statusline-forward.mjs");

type Received = { method: string | undefined; url: string | undefined; headers: IncomingMessage["headers"]; body: Buffer };

type Outcome = { code: number | null; stdout: string; stderr: string; elapsedMs: number };

let server: Server | undefined;
let sockets: Set<Socket>;
let received: Received[];

/** Starts a scratch receiver on an ephemeral loopback port and returns its port. */
async function listen(respond: boolean): Promise<number> {
	server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
			if (respond) {
				res.statusCode = 204;
				res.end();
			}
		});
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	await new Promise<void>((done) => server?.listen(0, "127.0.0.1", done));
	return (server.address() as AddressInfo).port;
}

/** Finds a loopback port with nothing listening on it. */
async function unusedPort(): Promise<number> {
	const probe = createServer();
	await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
	const port = (probe.address() as AddressInfo).port;
	await new Promise<void>((done) => probe.close(() => done()));
	return port;
}

function runForwarder(port: number, input: Buffer | string | undefined): Promise<Outcome> {
	return new Promise((done) => {
		const started = Date.now();
		const child = spawn(process.execPath, [SCRIPT], {
			env: { ...process.env, CLAUDE_DECK_PORT: String(port) },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("close", (code) => done({ code, stdout, stderr, elapsedMs: Date.now() - started }));
		if (input !== undefined) {
			child.stdin.write(input);
		}
		child.stdin.end();
	});
}

const waitFor = async (condition: () => boolean, timeoutMs = 3000): Promise<void> => {
	const end = Date.now() + timeoutMs;
	while (!condition() && Date.now() < end) {
		await new Promise((done) => setTimeout(done, 10));
	}
};

beforeEach(() => {
	received = [];
	sockets = new Set();
});

afterEach(async () => {
	for (const socket of sockets) {
		socket.destroy();
	}
	await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
	server = undefined;
});

describe("statusline-forward.mjs", () => {
	it("posts the exact stdin body to /statusline", async () => {
		const port = await listen(true);
		const body = JSON.stringify({ session_id: "s1", model: { display_name: "Opus" }, text: "café ✓" });
		const outcome = await runForwarder(port, body);
		await waitFor(() => received.length > 0);
		expect(outcome.code).toBe(0);
		expect(received).toHaveLength(1);
		expect(received[0]?.method).toBe("POST");
		expect(received[0]?.url).toBe("/statusline");
		expect(received[0]?.body.toString("utf8")).toBe(body);
	});

	it("sends a Content-Length equal to the byte length of the body and a JSON content type", async () => {
		const port = await listen(true);
		const body = JSON.stringify({ name: "café ✓ \u{1F600}" });
		await runForwarder(port, body);
		await waitFor(() => received.length > 0);
		expect(received[0]?.headers["content-length"]).toBe(String(Buffer.byteLength(body)));
		expect(Number(received[0]?.headers["content-length"])).toBe(received[0]?.body.length);
		expect(received[0]?.headers["content-type"]).toBe("application/json");
	});

	it("forwards a large body in full", async () => {
		const port = await listen(true);
		const body = JSON.stringify({ blob: "x".repeat(300_000) });
		await runForwarder(port, body);
		await waitFor(() => received.length > 0);
		expect(received[0]?.body.toString("utf8")).toBe(body);
	});

	it("forwards a body that is not JSON unchanged", async () => {
		const port = await listen(true);
		await runForwarder(port, "not json\n");
		await waitFor(() => received.length > 0);
		expect(received[0]?.body.toString("utf8")).toBe("not json\n");
	});

	it("prints nothing and exits 0 quickly", async () => {
		const port = await listen(true);
		const outcome = await runForwarder(port, JSON.stringify({ session_id: "s1" }));
		expect(outcome.stdout).toBe("");
		expect(outcome.stderr).toBe("");
		expect(outcome.code).toBe(0);
		expect(outcome.elapsedMs).toBeLessThan(1500);
	});

	it("sends nothing for empty stdin", async () => {
		const port = await listen(true);
		const outcome = await runForwarder(port, undefined);
		expect(outcome.code).toBe(0);
		expect(outcome.stdout).toBe("");
		expect(outcome.stderr).toBe("");
		await new Promise((done) => setTimeout(done, 100));
		expect(received).toEqual([]);
	});

	it("exits 0 silently when nothing is listening", async () => {
		const port = await unusedPort();
		const outcome = await runForwarder(port, JSON.stringify({ session_id: "s1" }));
		expect(outcome.code).toBe(0);
		expect(outcome.stdout).toBe("");
		expect(outcome.stderr).toBe("");
		expect(outcome.elapsedMs).toBeLessThan(1500);
	});

	it("exits within about two seconds when the server never answers", async () => {
		const port = await listen(false);
		const outcome = await runForwarder(port, JSON.stringify({ session_id: "s1" }));
		await waitFor(() => received.length > 0, 500);
		expect(outcome.code).toBe(0);
		expect(outcome.stdout).toBe("");
		expect(outcome.stderr).toBe("");
		expect(outcome.elapsedMs).toBeLessThan(2500);
		expect(received).toHaveLength(1);
	}, 10_000);
});
