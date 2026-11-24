import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSetup } from "../../src/setup/installer";

const CHECK = JSON.stringify({ hooks: true, statusLine: "forwarder" });

describe("runSetup", () => {
	let run: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		run = vi.fn();
	});

	describe("check", () => {
		it("runs only --check", async () => {
			run.mockResolvedValueOnce(CHECK + "\n");
			const result = await runSetup("check", run);
			expect(run.mock.calls).toEqual([[["--check"]]]);
			expect(result).toEqual({ ok: true, status: { hooks: true, statusLine: "forwarder" }, message: "" });
		});
	});

	describe("install", () => {
		it("runs --statusline and then --check", async () => {
			run.mockResolvedValueOnce("Installed the status line forwarder.\nInstalled hooks in C:\\x\\settings.json\n").mockResolvedValueOnce(CHECK);
			const result = await runSetup("install", run);
			expect(run.mock.calls).toEqual([[["--statusline"]], [["--check"]]]);
			expect(result).toEqual({
				ok: true,
				status: { hooks: true, statusLine: "forwarder" },
				message: "Installed the status line forwarder.",
			});
		});

		it("keeps the note about a different status line", async () => {
			run
				.mockResolvedValueOnce("A different status line is already configured, so it was left unchanged. Use --force-statusline to replace it.\nInstalled hooks in f\n")
				.mockResolvedValueOnce(JSON.stringify({ hooks: true, statusLine: "other" }));
			const result = await runSetup("install", run);
			expect(result).toMatchObject({ ok: true, status: { hooks: true, statusLine: "other" } });
			expect(result.message).toContain("A different status line is already configured");
		});
	});

	describe("remove", () => {
		it("runs --remove and then --check", async () => {
			run.mockResolvedValueOnce("Removed the status line forwarder.\nRemoved hooks from f\n").mockResolvedValueOnce(JSON.stringify({ hooks: false, statusLine: "none" }));
			const result = await runSetup("remove", run);
			expect(run.mock.calls).toEqual([[["--remove"]], [["--check"]]]);
			expect(result).toEqual({ ok: true, status: { hooks: false, statusLine: "none" }, message: "Removed the status line forwarder." });
		});
	});

	describe("message", () => {
		it("is empty when the script only prints the installed hooks line", async () => {
			run.mockResolvedValueOnce("Installed hooks in f\n").mockResolvedValueOnce(CHECK);
			expect((await runSetup("install", run)).message).toBe("");
		});

		it("joins several note lines with spaces and ignores blank lines and CRLF", async () => {
			run.mockResolvedValueOnce("first note.\r\n\r\n  second note.  \r\nRemoved hooks from f\r\n").mockResolvedValueOnce(CHECK);
			expect((await runSetup("remove", run)).message).toBe("first note. second note.");
		});
	});

	describe("status normalisation", () => {
		it.each([
			[{ hooks: true, statusLine: "forwarder" }, { hooks: true, statusLine: "forwarder" }],
			[{ hooks: false, statusLine: "other" }, { hooks: false, statusLine: "other" }],
			[{ hooks: true, statusLine: "none" }, { hooks: true, statusLine: "none" }],
			[{ hooks: true, statusLine: "mystery" }, { hooks: true, statusLine: "none" }],
			[{ hooks: true, statusLine: 5 }, { hooks: true, statusLine: "none" }],
			[{ hooks: true }, { hooks: true, statusLine: "none" }],
			[{ hooks: "true", statusLine: "forwarder" }, { hooks: false, statusLine: "forwarder" }],
			[{ hooks: 1, statusLine: "other" }, { hooks: false, statusLine: "other" }],
			[{}, { hooks: false, statusLine: "none" }],
		])("normalises %j to %j", async (raw, expected) => {
			run.mockResolvedValueOnce(JSON.stringify(raw));
			const result = await runSetup("check", run);
			expect(result).toMatchObject({ ok: true, status: expected });
		});

		it("reads the last line of the check output", async () => {
			run.mockResolvedValueOnce("noise\n" + CHECK + "\n");
			expect(await runSetup("check", run)).toMatchObject({ ok: true, status: { hooks: true, statusLine: "forwarder" } });
		});
	});

	describe("failures", () => {
		it("reports a thrown error from the action", async () => {
			run.mockRejectedValueOnce(new Error("script crashed"));
			expect(await runSetup("install", run)).toEqual({ ok: false, message: "script crashed" });
			expect(run).toHaveBeenCalledTimes(1);
		});

		it("reports a thrown error from the check", async () => {
			run.mockRejectedValueOnce(new Error("no node"));
			expect(await runSetup("check", run)).toEqual({ ok: false, message: "no node" });
		});

		it("reports a thrown error from the check after a successful action", async () => {
			run.mockResolvedValueOnce("Installed hooks in f\n").mockRejectedValueOnce(new Error("check failed"));
			expect(await runSetup("install", run)).toEqual({ ok: false, message: "check failed" });
		});

		it("reports a thrown value that is not an Error", async () => {
			run.mockRejectedValueOnce("plain");
			expect(await runSetup("check", run)).toEqual({ ok: false, message: "plain" });
		});

		it("reports unparsable check output", async () => {
			run.mockResolvedValueOnce("not json");
			const result = await runSetup("check", run);
			expect(result.ok).toBe(false);
			expect(result.message.length).toBeGreaterThan(0);
		});

		it("reports empty check output", async () => {
			run.mockResolvedValueOnce("");
			expect((await runSetup("check", run)).ok).toBe(false);
		});

		it("reports check output that is JSON null", async () => {
			run.mockResolvedValueOnce("null");
			expect((await runSetup("check", run)).ok).toBe(false);
		});
	});
});
