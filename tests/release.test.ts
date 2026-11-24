import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");
const pkg = JSON.parse(read("package.json"));

describe("changelog", () => {
	it("starts with a title", () => {
		expect(read("CHANGELOG.md").startsWith("# Changelog")).toBe(true);
	});

	it("records the first release", () => {
		expect(read("CHANGELOG.md")).toMatch(/^## 0\.1\.0 - \d{4}-\d{2}-\d{2}$/m);
	});

	it("says where the notes for later releases are", () => {
		expect(read("CHANGELOG.md")).toContain("GitHub release");
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

	it("only call npm scripts and project scripts that exist", () => {
		for (const text of [ci, release]) {
			for (const match of text.matchAll(/npm run ([\w:-]+)/g)) {
				expect(typeof pkg.scripts[match[1] as string], `npm run ${match[1]}`).toBe("string");
			}
			for (const match of text.matchAll(/node (scripts\/[\w.-]+\.mjs)/g)) {
				expect(existsSync(resolve(ROOT, match[1] as string)), match[1]).toBe(true);
			}
		}
	});

	it("install from the lockfile and read the whole history so the release tags are available", () => {
		for (const text of [ci, release]) {
			expect(text).toContain("npm ci");
			expect(text).toMatch(/fetch-depth: 0/);
		}
	});

	it("do not contain secrets", () => {
		for (const text of [ci, release]) {
			expect(text).not.toMatch(/ghp_|github_pat_|-----BEGIN/);
		}
		expect(release).toContain("secrets.GITHUB_TOKEN");
	});
});

describe("checks workflow", () => {
	const ci = read(".github/workflows/ci.yml");

	it("runs on branches other than the main branch and on pull requests into it", () => {
		expect(ci).toMatch(/push:\s+branches-ignore: \[master, main\]/);
		expect(ci).toMatch(/pull_request:\s+branches: \[master, main\]/);
	});

	it("only reads the repository", () => {
		expect(ci).toMatch(/permissions:\s+contents: read/);
		expect(ci).not.toContain("contents: write");
	});

	it("shares one concurrency group between a push and a pull request of the same branch", () => {
		expect(ci).toContain("group: ci-${{ github.head_ref || github.ref_name }}");
		expect(ci).toContain("cancel-in-progress: true");
	});

	it("builds the head of a pull request, not the merge result", () => {
		expect(ci).toContain("ref: ${{ github.event.pull_request.head.sha || github.sha }}");
	});

	it("chooses the branch version from the commits beyond the default branch", () => {
		expect(ci).toContain("github.event.repository.default_branch");
		expect(ci).toContain("git rev-list --count --no-merges");
		expect(ci).toContain("node scripts/next-version.mjs --branch");
	});

	it("applies the version, then type-checks, tests, packages, and uploads the package under its version", () => {
		const order = ["next-version.mjs --branch", "set-version.mjs", "npm run typecheck", "npm test", "npm run package", "upload-artifact"].map((s) => ci.indexOf(s));
		expect(order.every((i) => i > -1)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(ci).toContain("name: claude-deck-${{ steps.version.outputs.version }}");
	});
});

describe("release workflow", () => {
	const release = read(".github/workflows/release.yml");

	it("runs on pushes to the main branch only", () => {
		expect(release).toMatch(/push:\s+branches: \[master, main\]/);
		expect(release).not.toContain("pull_request");
		expect(release).not.toContain("tags:");
	});

	it("needs write access to contents only", () => {
		expect(release).toMatch(/permissions:\s+contents: write/);
		expect(release).not.toMatch(/(issues|pull-requests|actions|packages|deployments): write/);
	});

	it("runs one release at a time without cancelling a release in progress", () => {
		expect(release).toContain("group: release");
		expect(release).toContain("cancel-in-progress: false");
	});

	it("chooses the version from the release tags without a branch option", () => {
		expect(release).toContain("git tag --list 'v*' | node scripts/next-version.mjs");
		expect(release).not.toContain("next-version.mjs --branch");
	});

	it("applies the version, then type-checks, tests, packages, and publishes", () => {
		const order = ["next-version.mjs", "set-version.mjs", "npm run typecheck", "npm test", "npm run package", "gh release create"].map((s) => release.indexOf(s));
		expect(order.every((i) => i > -1)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	it("publishes the package at the tested commit with generated notes", () => {
		expect(release).toContain('gh release create "v${{ steps.version.outputs.version }}"');
		expect(release).toContain("dist/*.streamDeckPlugin");
		expect(release).toContain('--target "$GITHUB_SHA"');
		expect(release).toContain("--generate-notes");
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
