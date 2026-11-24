import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { textContent, xmlProblem } from "../helpers/xml";

const SCRIPT = resolve(__dirname, "../../com.claudedeck.controls.sdPlugin/scripts/notify.ps1");
const NOTIFIER_SOURCE = readFileSync(resolve(__dirname, "../../src/alerts/notifier.ts"), "utf8");
const SCRIPT_SOURCE = readFileSync(SCRIPT, "utf8");
const TIMEOUT = 30_000;

type Input = { title?: string; body?: string; sound?: string; toast?: string };
type Result = { status: number | null; stdout: string; stderr: string; lines: string[] };

/**
 * Runs the script in dry-run mode. The environment always carries CLAUDE_DECK_DRY_RUN=1, and the spawn is
 * refused when it does not, so the script never plays a sound or shows a notification.
 */
function runDry(input: Input): Result {
	const env: Record<string, string | undefined> = { ...process.env, CLAUDE_DECK_DRY_RUN: "1" };
	for (const key of ["CLAUDE_DECK_TITLE", "CLAUDE_DECK_BODY", "CLAUDE_DECK_SOUND", "CLAUDE_DECK_TOAST"]) delete env[key];
	if (input.title !== undefined) env.CLAUDE_DECK_TITLE = input.title;
	if (input.body !== undefined) env.CLAUDE_DECK_BODY = input.body;
	if (input.sound !== undefined) env.CLAUDE_DECK_SOUND = input.sound;
	if (input.toast !== undefined) env.CLAUDE_DECK_TOAST = input.toast;
	if (env.CLAUDE_DECK_DRY_RUN !== "1") {
		throw new Error("dry-run mode is not enabled");
	}
	const result = spawnSync(
		"powershell.exe",
		["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT],
		{ env: env as NodeJS.ProcessEnv, encoding: "utf8", windowsHide: true, timeout: TIMEOUT },
	);
	const lines = result.stdout.split(/\r?\n/);
	if (lines[lines.length - 1] === "") lines.pop();
	return { status: result.status, stdout: result.stdout, stderr: result.stderr, lines };
}

const toastXml = (title: string, body: string): string =>
	`<toast><visual><binding template='ToastGeneric'><text>${title}</text><text>${body}</text></binding></visual></toast>`;

/** Toast XML from the single printed toast line. */
function xmlOf(result: Result): string {
	const line = result.lines.find((l) => l.startsWith("toast "));
	if (line === undefined) throw new Error(`no toast line in ${JSON.stringify(result.lines)}`);
	return line.slice("toast ".length);
}

/** Text of the two `<text>` elements of a toast document. */
function texts(xml: string): string[] {
	return [...xml.matchAll(/<text>([\s\S]*?)<\/text>/g)].map((m) => m[1] as string);
}

const unescape = (value: string): string =>
	value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

describe.skipIf(process.platform !== "win32")("notify.ps1 dry run", { timeout: TIMEOUT }, () => {
	describe("output lines", () => {
		it("prints one sound line when only the sound is enabled", () => {
			const result = runDry({ sound: "1", title: "T", body: "B" });
			expect(result.status).toBe(0);
			expect(result.lines).toEqual(["sound"]);
		});

		it("prints one toast line when only the toast is enabled", () => {
			const result = runDry({ toast: "1", title: "T", body: "B" });
			expect(result.status).toBe(0);
			expect(result.lines).toEqual([`toast ${toastXml("T", "B")}`]);
		});

		it("prints the sound line before the toast line when both are enabled", () => {
			const result = runDry({ sound: "1", toast: "1", title: "T", body: "B" });
			expect(result.status).toBe(0);
			expect(result.lines).toEqual(["sound", `toast ${toastXml("T", "B")}`]);
		});

		it("prints nothing and exits 0 when neither is enabled", () => {
			const result = runDry({ title: "T", body: "B" });
			expect(result.status).toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");
		});

		it("writes nothing to standard error", () => {
			const result = runDry({ sound: "1", toast: "1", title: "T", body: "B" });
			expect(result.stderr).toBe("");
		});
	});

	describe("enabling values", () => {
		for (const value of ["0", "true", "yes", "", "2", " 1", "1 ", "on"]) {
			it(`does not enable the sound for ${JSON.stringify(value)}`, () => {
				const result = runDry({ sound: value, title: "T", body: "B" });
				expect(result.status).toBe(0);
				expect(result.stdout).toBe("");
			});

			it(`does not enable the toast for ${JSON.stringify(value)}`, () => {
				const result = runDry({ toast: value, title: "T", body: "B" });
				expect(result.status).toBe(0);
				expect(result.stdout).toBe("");
			});
		}

		it("enables the sound independently of the toast value", () => {
			expect(runDry({ sound: "1", toast: "0" }).lines).toEqual(["sound"]);
		});

		it("enables the toast independently of the sound value", () => {
			expect(runDry({ sound: "0", toast: "1", title: "T", body: "B" }).lines).toEqual([`toast ${toastXml("T", "B")}`]);
		});
	});

	describe("toast XML", () => {
		it("has the exact notification structure", () => {
			expect(xmlOf(runDry({ toast: "1", title: "Claude needs you", body: "demo - Bash: ls" }))).toBe(
				toastXml("Claude needs you", "demo - Bash: ls"),
			);
		});

		it("escapes & < > \" and ' in the title and body", () => {
			const result = runDry({ toast: "1", title: `a&b<c>d"e'f`, body: `1&2<3>4"5'6` });
			expect(xmlOf(result)).toBe(toastXml("a&amp;b&lt;c&gt;d&quot;e&apos;f", "1&amp;2&lt;3&gt;4&quot;5&apos;6"));
		});

		it("escapes each special character on its own", () => {
			const cases: [string, string][] = [
				["&", "&amp;"],
				["<", "&lt;"],
				[">", "&gt;"],
				['"', "&quot;"],
				["'", "&apos;"],
			];
			for (const [raw, escaped] of cases) {
				expect(xmlOf(runDry({ toast: "1", title: raw, body: raw })), raw).toBe(toastXml(escaped, escaped));
			}
		});

		it("escapes the ampersand of text that looks like an entity", () => {
			expect(texts(xmlOf(runDry({ toast: "1", title: "&amp;", body: "" })))[0]).toBe("&amp;amp;");
		});

		it("keeps the document well formed with special characters", () => {
			const xml = xmlOf(runDry({ toast: "1", title: `<b>&"'`, body: `</text>&<>'"` }));
			expect(xmlProblem(xml.replace("template='ToastGeneric'", 'template="ToastGeneric"'))).toBe("");
		});

		it("round-trips the title and body through the escaping", () => {
			const title = `Tom & "Jerry" <1>`;
			const body = `it's <b>bold</b> & more`;
			const parts = texts(xmlOf(runDry({ toast: "1", title, body })));
			expect(parts.map(unescape)).toEqual([title, body]);
		});

		it("cannot add elements through markup-like text", () => {
			const xml = xmlOf(runDry({ toast: "1", title: "</text><text>injected", body: "<toast><text>x</text></toast>" }));
			expect(texts(xml)).toHaveLength(2);
			expect(xml.match(/<text>/g)).toHaveLength(2);
			expect(xml.match(/<toast>/g)).toHaveLength(1);
			expect(xml).not.toContain("<text>injected");
			expect(texts(xml)[0]).toBe("&lt;/text&gt;&lt;text&gt;injected");
		});

		it("cannot add attributes through quotes in the text", () => {
			const xml = xmlOf(runDry({ toast: "1", title: `x' onclick='y`, body: `x" onclick="y` }));
			expect(xml).toBe(toastXml("x&apos; onclick=&apos;y", "x&quot; onclick=&quot;y"));
		});

		it("uses empty text elements for empty title and body", () => {
			expect(xmlOf(runDry({ toast: "1", title: "", body: "" }))).toBe(toastXml("", ""));
		});

		it("uses empty text elements for a missing title and body", () => {
			expect(xmlOf(runDry({ toast: "1" }))).toBe(toastXml("", ""));
		});

		it("uses an empty text element for only the missing field", () => {
			expect(xmlOf(runDry({ toast: "1", title: "T" }))).toBe(toastXml("T", ""));
			expect(xmlOf(runDry({ toast: "1", body: "B" }))).toBe(toastXml("", "B"));
		});

		it("keeps line breaks in the body inside the text element, which spans several printed lines", () => {
			const result = runDry({ toast: "1", title: "T", body: "first\nsecond" });
			expect(result.status).toBe(0);
			const printed = result.stdout.replace(/\r\n/g, "\n");
			expect(printed).toBe(`toast ${toastXml("T", "first\nsecond")}\n`);
			expect(result.lines).toHaveLength(2);
			expect(result.lines[0]).toBe("toast <toast><visual><binding template='ToastGeneric'><text>T</text><text>first");
			expect(result.lines[1]).toBe("second</text></binding></visual></toast>");
		});

		it("keeps carriage returns and line feeds in the title", () => {
			const result = runDry({ toast: "1", title: "a\r\nb", body: "B" });
			expect(result.stdout.replace(/\r\n/g, "\n")).toBe(`toast ${toastXml("a\nb", "B")}\n`);
		});

		it("prints the sound line first even when the body has line breaks", () => {
			const result = runDry({ sound: "1", toast: "1", title: "T", body: "a\nb" });
			expect(result.lines[0]).toBe("sound");
			expect(result.lines[1]?.startsWith("toast ")).toBe(true);
		});

		it("keeps plain text content of the title and body", () => {
			const xml = xmlOf(runDry({ toast: "1", title: "Claude needs you", body: "project - Bash: npm test" }));
			expect(textContent(xml)).toBe("Claude needs youproject - Bash: npm test");
		});

		it("passes long text through unchanged", () => {
			const body = "x".repeat(2000);
			expect(xmlOf(runDry({ toast: "1", title: "T", body }))).toBe(toastXml("T", body));
		});
	});
});

describe("notify.ps1 inputs and the notifier", () => {
	const names = ["CLAUDE_DECK_TITLE", "CLAUDE_DECK_BODY", "CLAUDE_DECK_SOUND", "CLAUDE_DECK_TOAST"];

	it("reads each variable the notifier passes", () => {
		for (const name of names) {
			expect(SCRIPT_SOURCE, name).toMatch(new RegExp(`\\$env:${name}\\b`));
			expect(NOTIFIER_SOURCE, name).toMatch(new RegExp(`${name}\\s*:`));
		}
	});

	it("passes no variable that the script does not read", () => {
		const passed = [...NOTIFIER_SOURCE.matchAll(/\b(CLAUDE_DECK_[A-Z_]+)\s*:/g)].map((m) => m[1] as string);
		expect([...passed].sort()).toEqual([...names].sort());
		const read = [...SCRIPT_SOURCE.matchAll(/\$env:(CLAUDE_DECK_[A-Z_]+)/g)].map((m) => m[1] as string);
		expect(new Set(read)).toEqual(new Set([...names, "CLAUDE_DECK_DRY_RUN"]));
	});

	it("passes the enabling flags as the string 1 or 0", () => {
		expect(NOTIFIER_SOURCE).toMatch(/CLAUDE_DECK_SOUND:\s*alert\.sound \? "1" : "0"/);
		expect(NOTIFIER_SOURCE).toMatch(/CLAUDE_DECK_TOAST:\s*alert\.toast \? "1" : "0"/);
		expect(SCRIPT_SOURCE).toMatch(/\$env:CLAUDE_DECK_SOUND -eq '1'/);
		expect(SCRIPT_SOURCE).toMatch(/\$env:CLAUDE_DECK_TOAST -eq '1'/);
	});

	it("does not set the dry-run variable from the notifier", () => {
		expect(NOTIFIER_SOURCE).not.toContain("CLAUDE_DECK_DRY_RUN");
	});
});
