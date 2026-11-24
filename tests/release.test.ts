import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");
const pkg = JSON.parse(read("package.json"));

const SCRIPT = resolve(ROOT, "scripts/release-notes.mjs");
const temp = mkdtempSync(join(tmpdir(), "release-notes-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function notes(version: string | undefined, changelog?: string): { status: number | null; stdout: string; stderr: string } {
	const args = [SCRIPT];
	if (version !== undefined) {
		args.push(version);
	}
	if (changelog !== undefined) {
		const file = join(temp, `changelog-${Math.random().toString(36).slice(2)}.md`);
		writeFileSync(file, changelog);
		args.push(file);
	}
	const result = spawnSync(process.execPath, args, { encoding: "utf8" });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("release notes script", () => {
	const changelog = ["# Changelog", "", "## 2.0.0 - 2026-02-01", "", "Second release.", "", "- Added a thing", "", "## 1.0.0", "", "First release.", ""].join("\n");

	it("prints the section for a version with a date in its heading", () => {
		const result = notes("2.0.0", changelog);
		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toBe("Second release.\n\n- Added a thing");
	});

	it("prints the last section, which has no heading after it", () => {
		expect(notes("1.0.0", changelog).stdout.trim()).toBe("First release.");
	});

	it("handles Windows line endings", () => {
		const result = notes("2.0.0", changelog.replace(/\n/g, "\r\n"));
		expect(result.status).toBe(0);
		expect(result.stdout).not.toContain("\r");
		expect(result.stdout.trim()).toBe("Second release.\n\n- Added a thing");
	});

	it("does not match a version that is only a prefix of a heading", () => {
		const result = notes("2.0", changelog);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("No changelog section for version 2.0");
	});

	it("does not match a version that only appears inside a section", () => {
		const result = notes("3.0.0", `${changelog}\nMentions 3.0.0 in text.\n`);
		expect(result.status).toBe(1);
	});

	it("fails for a version with no section", () => {
		const result = notes("9.9.9", changelog);
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("No changelog section for version 9.9.9");
	});

	it("fails for a section with no content", () => {
		const result = notes("1.0.0", "## 1.0.0\n\n## 0.9.0\n\nOlder.\n");
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("empty");
	});

	it("fails with a usage message when no version is given", () => {
		const result = notes(undefined);
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("Usage:");
	});

	it("treats the dots in a version literally", () => {
		expect(notes("1x0x0", changelog).status).toBe(1);
	});
});

describe("changelog", () => {
	it("has a non-empty section for the current package version", () => {
		const result = notes(pkg.version);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout.trim().length).toBeGreaterThan(20);
	});

	it("starts with a title and lists the newest version first", () => {
		const text = read("CHANGELOG.md");
		expect(text.startsWith("# Changelog")).toBe(true);
		const first = /^## (\d+\.\d+\.\d+)/m.exec(text)?.[1];
		expect(first).toBe(pkg.version);
	});
});

describe("workflows", () => {
	const ci = read(".github/workflows/ci.yml");
	const release = read(".github/workflows/release.yml");

	it("run on a Windows runner with Node.js 24", () => {
		for (const text of [ci, release]) {
			expect(text).toContain("runs-on: windows-latest");
			expect(text).toMatch(/node-version: 24\b/);
		}
	});

	it("only call npm scripts that exist", () => {
		for (const text of [ci, release]) {
			for (const match of text.matchAll(/npm run ([\w:-]+)/g)) {
				expect(typeof pkg.scripts[match[1] as string], `npm run ${match[1]}`).toBe("string");
			}
		}
	});

	it("check runs on pushes to the main branch and on pull requests, and installs from the lockfile", () => {
		expect(ci).toMatch(/push:\s+branches: \[master, main\]/);
		expect(ci).toContain("pull_request:");
		expect(ci).toContain("npm ci");
		expect(ci.indexOf("npm run typecheck")).toBeLessThan(ci.indexOf("npm test"));
		expect(ci.indexOf("npm test")).toBeLessThan(ci.indexOf("npm run package"));
		expect(ci).toContain("actions/upload-artifact@v4");
		expect(ci).toMatch(/contents: read/);
	});

	it("release runs on version tags and needs write access to contents only", () => {
		expect(release).toMatch(/tags: \["v\*"\]/);
		expect(release).toMatch(/contents: write/);
		expect(release).not.toMatch(/pull_request/);
	});

	it("release checks the tag against the package version before testing and packaging", () => {
		const check = release.indexOf("does not match package version");
		expect(check).toBeGreaterThan(-1);
		expect(check).toBeLessThan(release.indexOf("npm test"));
		expect(release.indexOf("npm test")).toBeLessThan(release.indexOf("npm run package"));
	});

	it("release takes its notes from the changelog and attaches the package", () => {
		expect(release).toContain("scripts/release-notes.mjs");
		expect(release).toContain("gh release create");
		expect(release).toContain("dist/*.streamDeckPlugin");
		expect(release).toContain("--notes-file");
	});

	it("do not contain secrets", () => {
		for (const text of [ci, release]) {
			expect(text).not.toMatch(/ghp_|github_pat_|-----BEGIN/);
		}
		expect(release).toContain("secrets.GITHUB_TOKEN");
	});
});

describe(".gitattributes", () => {
	const text = read(".gitattributes");

	it("keeps text files on Unix line endings", () => {
		expect(text).toMatch(/^\* text=auto eol=lf$/m);
	});

	it.each(["*.gif", "*.png", "*.streamDeckProfile", "*.streamDeckPlugin"])("marks %s as binary", (pattern) => {
		expect(text).toContain(`${pattern} binary`);
	});
});
