import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../scripts/next-version.mjs");

let dir: string;
let counter = 0;

type Result = { status: number | null; stdout: string; stderr: string };

/** Writes a temporary package.json holding the given version value; undefined omits the field. */
function packageFile(version: unknown): string {
	const file = join(dir, `package-${counter++}.json`);
	writeFileSync(file, JSON.stringify(version === undefined ? { name: "x" } : { name: "x", version }));
	return file;
}

/** Runs the script with arguments and tags on standard input. */
function runRaw(args: string[], input: string): Result {
	const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", input });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Runs the script with tags on standard input and a temporary package.json. */
function run(input: string, options: { pkg?: unknown; args?: string[]; pkgFile?: string } = {}): Result {
	const file = options.pkgFile ?? packageFile("pkg" in options ? options.pkg : "0.1.0");
	return runRaw([...(options.args ?? []), "--package", file], input);
}

const tags = (...list: string[]) => list.join("\n") + "\n";
const release = (input: string, pkg = "0.1.0") => run(input, { pkg }).stdout;
const branch = (input: string, commits: string, pkg = "0.1.0") => run(input, { pkg, args: ["--branch", commits] }).stdout;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "next-version-"));
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("next-version on the main branch", () => {
	it.each([
		[["v0.1.0"], "0.2.0"],
		[["v0.1.0", "v0.2.0"], "0.3.0"],
		[["v0.1.0", "v0.2.0", "v0.2.3"], "0.3.0"],
		[["v0.2.3"], "0.3.0"],
		[["v0.2.0", "v0.1.0"], "0.3.0"],
		[["v0.2.0", "v0.1.0", "v0.2.0", "v0.1.0"], "0.3.0"],
		[["v0.2.3", "v0.2.0", "v0.1.9"], "0.3.0"],
		[["v0.9.0", "v0.10.0"], "0.11.0"],
		[["v0.10.0", "v0.9.0"], "0.11.0"],
		[["v0.2.0", "v0.10.0", "v0.9.0"], "0.11.0"],
		[["v0.1.10", "v0.1.9"], "0.2.0"],
		[["v1.4.2"], "1.5.0"],
		[["v0.9.0", "v1.0.0"], "1.1.0"],
		[["v1.0.0", "v0.9.0"], "1.1.0"],
		[["v0.99.0", "v1.0.0", "v0.100.0"], "1.1.0"],
	])("tags %j give %s", (list, expected) => {
		const result = run(tags(...list));
		expect(result.status).toBe(0);
		expect(result.stdout).toBe(`${expected}\n`);
		expect(result.stderr).toBe("");
	});

	it.each([
		"latest",
		"nightly",
		"v0.1",
		"v0.1.x",
		"v0.1.3-rc1",
		"v0.1.3.4",
		"v0.1.3+build",
		"0.5.0",
		"V0.5.0",
		"vv0.5.0",
		" v0.5.0",
		"v-1.0.0",
		"",
		"   ",
		"\t",
	])("ignores the line %j", (line) => {
		expect(release(tags("v0.1.0", line, "v0.1.5"))).toBe("0.2.0\n");
		expect(release(tags(line))).toBe("0.1.0\n");
	});

	it("ignores every tag that is not a release when there are several", () => {
		expect(release(tags("latest", "v0.1", "v0.3.0", "0.9.0", "v0.4.0-rc1", "v0.2.0"))).toBe("0.4.0\n");
	});

	it("accepts Windows line endings", () => {
		expect(release("v0.1.0\r\nv0.2.0\r\nv0.2.3\r\n")).toBe("0.3.0\n");
	});

	it("accepts mixed line endings and blank lines", () => {
		expect(release("v0.1.0\r\n\r\nv0.4.0\n\n\r\nlatest\r\n")).toBe("0.5.0\n");
	});

	it("accepts input without a trailing newline", () => {
		expect(release("v0.1.0\nv0.2.0")).toBe("0.3.0\n");
		expect(release("v0.7.0")).toBe("0.8.0\n");
	});

	it("accepts input with several trailing newlines", () => {
		expect(release("v0.1.0\nv0.2.0\n\n\n")).toBe("0.3.0\n");
	});

	it("accepts whitespace after a tag", () => {
		expect(release("v0.1.0  \nv0.2.0\t\n")).toBe("0.3.0\n");
	});

	it("uses a package version that is higher than the computed version", () => {
		expect(release(tags("v0.4.0"), "1.0.0")).toBe("1.0.0\n");
		expect(release(tags("v0.2.0"), "0.3.1")).toBe("0.3.1\n");
		expect(release(tags("v0.2.0"), "0.10.0")).toBe("0.10.0\n");
		expect(release(tags("v0.9.0"), "0.10.0")).toBe("0.10.0\n");
		expect(release(tags("v1.4.2"), "2.0.0")).toBe("2.0.0\n");
	});

	it("ignores a package version that is equal to the computed version", () => {
		expect(release(tags("v0.2.0"), "0.3.0")).toBe("0.3.0\n");
	});

	it("ignores a package version that is lower than the computed version", () => {
		expect(release(tags("v0.2.0"), "0.1.0")).toBe("0.3.0\n");
		expect(release(tags("v0.2.0"), "0.2.9")).toBe("0.3.0\n");
		expect(release(tags("v0.2.0"), "0.0.1")).toBe("0.3.0\n");
		expect(release(tags("v1.4.2"), "0.99.99")).toBe("1.5.0\n");
		expect(release(tags("v0.10.0"), "0.9.0")).toBe("0.11.0\n");
	});

	it("prints the package version as it is when there are no tags", () => {
		expect(release("", "0.1.0")).toBe("0.1.0\n");
		expect(release("\n", "0.1.0")).toBe("0.1.0\n");
		expect(release("\r\n\r\n", "0.1.0")).toBe("0.1.0\n");
		expect(release(tags("latest", "v0.1"), "0.1.0")).toBe("0.1.0\n");
		expect(release("", "3.14.15")).toBe("3.14.15\n");
	});

	it("prints exactly the version and a newline on standard output", () => {
		const result = run(tags("v0.1.0", "v0.2.0"));
		expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
		expect(result.stderr).toBe("");
	});
});

describe("next-version on a branch", () => {
	it.each([
		["1", "0.2.1"],
		["2", "0.2.2"],
		["10", "0.2.10"],
		["100", "0.2.100"],
		["0", "0.2.0"],
		["007", "0.2.7"],
	])("latest v0.2.0 and %s commits give %s", (commits, expected) => {
		const result = run(tags("v0.2.0"), { args: ["--branch", commits] });
		expect(result.status).toBe(0);
		expect(result.stdout).toBe(`${expected}\n`);
		expect(result.stderr).toBe("");
	});

	it("raises a non-zero patch of the latest release", () => {
		expect(branch(tags("v0.2.3"), "2")).toBe("0.2.5\n");
		expect(branch(tags("v0.2.3"), "0")).toBe("0.2.3\n");
	});

	it("uses the highest tag when it is listed first", () => {
		expect(branch(tags("v0.3.0", "v0.2.0", "v0.1.0"), "1")).toBe("0.3.1\n");
	});

	it("uses the highest tag when it is listed last", () => {
		expect(branch(tags("v0.1.0", "v0.2.0", "v0.3.0"), "1")).toBe("0.3.1\n");
	});

	it("uses the highest tag when it is listed in the middle", () => {
		expect(branch(tags("v0.1.0", "v0.3.0", "v0.2.0"), "4")).toBe("0.3.4\n");
	});

	it("compares tags numerically", () => {
		expect(branch(tags("v0.9.0", "v0.10.0"), "1")).toBe("0.10.1\n");
		expect(branch(tags("v0.1.9", "v0.1.10"), "1")).toBe("0.1.11\n");
		expect(branch(tags("v0.9.0", "v1.0.0"), "2")).toBe("1.0.2\n");
	});

	it("handles duplicate tags", () => {
		expect(branch(tags("v0.2.0", "v0.2.0", "v0.1.0"), "3")).toBe("0.2.3\n");
	});

	it("ignores tags that are not releases", () => {
		expect(branch(tags("latest", "v0.9", "v0.2.0", "v0.5.0-rc1", "0.8.0"), "1")).toBe("0.2.1\n");
	});

	it("accepts Windows line endings", () => {
		expect(branch("v0.1.0\r\nv0.2.0\r\n", "2")).toBe("0.2.2\n");
	});

	it("returns the release version for zero commits", () => {
		expect(branch(tags("v1.4.2", "v1.3.0"), "0")).toBe("1.4.2\n");
	});

	it("does not use the package version when tags exist", () => {
		expect(branch(tags("v0.2.0"), "1", "5.0.0")).toBe("0.2.1\n");
		expect(branch(tags("v0.2.0"), "1", "0.0.1")).toBe("0.2.1\n");
	});

	it("raises the package version when there are no tags", () => {
		expect(branch("", "3", "0.1.0")).toBe("0.1.3\n");
		expect(branch("", "0", "0.1.0")).toBe("0.1.0\n");
		expect(branch("", "12", "2.5.7")).toBe("2.5.19\n");
		expect(branch(tags("latest", "v0.1"), "3", "0.1.0")).toBe("0.1.3\n");
	});

	it("gives the same result whatever the order of the options", () => {
		const file = packageFile("0.4.0");
		expect(runRaw(["--branch", "2", "--package", file], "").stdout).toBe("0.4.2\n");
		expect(runRaw(["--package", file, "--branch", "2"], "").stdout).toBe("0.4.2\n");
		expect(runRaw(["--branch", "2", "--package", file], tags("v0.2.0")).stdout).toBe("0.2.2\n");
		expect(runRaw(["--package", file, "--branch", "2"], tags("v0.2.0")).stdout).toBe("0.2.2\n");
	});
});

describe("next-version errors", () => {
	it("fails with exit code 2 when --branch has no value", () => {
		const file = packageFile("0.1.0");
		const result = runRaw(["--package", file, "--branch"], tags("v0.1.0"));
		expect(result.status).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("--branch");
	});

	it("fails with exit code 2 when --branch is followed by another option", () => {
		const file = packageFile("0.1.0");
		const result = runRaw(["--branch", "--package", file], tags("v0.1.0"));
		expect(result.status).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).not.toBe("");
	});

	it.each(["abc", "1.5", "-1", "", " ", "1 ", "+1", "1e2", "0x10"])("fails with exit code 2 for the branch value %j", (value) => {
		const result = run(tags("v0.1.0"), { args: ["--branch", value] });
		expect(result.status).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("--branch");
	});

	it("fails for an invalid branch value when there are no tags", () => {
		const result = run("", { args: ["--branch", "abc"] });
		expect(result.status).toBe(2);
		expect(result.stdout).toBe("");
	});

	it.each(["1.2", "x", "1.2.3-beta", "1.2.3.4", "v1.2.3", "", "1.2.x", " 1.2.3", "1.2.3 "])(
		"fails with exit code 1 for the package version %j",
		(version) => {
			const result = run(tags("v0.1.0"), { pkg: version });
			expect(result.status).toBe(1);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain("MAJOR.MINOR.PATCH");
		},
	);

	it("fails with exit code 1 when the package version is missing", () => {
		const result = run(tags("v0.1.0"), { pkg: undefined });
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("MAJOR.MINOR.PATCH");
	});

	it.each([1, null, {}, true])("fails when the package version is the non-string value %j", (version) => {
		const result = run(tags("v0.1.0"), { pkg: version });
		expect(result.status).not.toBe(0);
		expect(result.stdout).toBe("");
	});

	it("fails for an invalid package version in branch mode", () => {
		const result = run(tags("v0.1.0"), { pkg: "1.2", args: ["--branch", "1"] });
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
	});

	it("fails for an invalid package version when there are no tags", () => {
		const result = run("", { pkg: "1.2.3-beta" });
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
	});

	it("fails when the package file does not exist", () => {
		const result = run(tags("v0.1.0"), { pkgFile: join(dir, "missing.json") });
		expect(result.status).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).not.toBe("");
	});

	it("fails when the package file is not valid JSON", () => {
		const file = join(dir, "broken.json");
		writeFileSync(file, "{ not json");
		const result = run(tags("v0.1.0"), { pkgFile: file });
		expect(result.status).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).not.toBe("");
	});

	it("fails when the package path is a directory", () => {
		const result = run(tags("v0.1.0"), { pkgFile: dir });
		expect(result.status).not.toBe(0);
		expect(result.stdout).toBe("");
	});
});

describe("next-version strictness", () => {
	it("ignores a tag with a space after the v", () => {
		expect(release(tags("v 0.5.0", "v0.1.0"))).toBe("0.2.0\n");
	});

	it("ignores a tag with a space inside the version", () => {
		expect(release(tags("v0.5 .0", "v0.1.0"))).toBe("0.2.0\n");
	});

	it("accepts whitespace after a valid tag", () => {
		expect(release(tags("v0.5.0  ", "v0.1.0\t"))).toBe("0.6.0\n");
	});

	it("ignores whitespace before a tag", () => {
		expect(release(tags("  v0.5.0", "\tv0.4.0", "v0.1.0"))).toBe("0.2.0\n");
	});

	it.each([
		["an array", ["1.2.3"]],
		["a number", 123],
		["an object", { major: 1 }],
		["null", null],
		["a boolean", true],
	])("rejects a package version that is %s", (_name, value) => {
		const result = run(tags("v0.1.0"), { pkg: value });
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("package.json");
	});
});
