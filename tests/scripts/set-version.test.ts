import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readZip } from "../helpers/zip";

const REAL_ROOT = resolve(__dirname, "../..");
const SCRIPT = join(REAL_ROOT, "scripts/set-version.mjs");
const PLUGIN = "com.claudedeck.controls.sdPlugin";
const REAL_FILES = [
	join(REAL_ROOT, "package.json"),
	join(REAL_ROOT, "package-lock.json"),
	join(REAL_ROOT, PLUGIN, "manifest.json"),
	join(REAL_ROOT, PLUGIN, "profiles/ClaudeDeck.streamDeckProfile"),
];

const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

let base: string;
let root: string;
let counter = 0;
const before = new Map<string, string>();

type Result = { status: number | null; stdout: string; stderr: string };

/** Runs the script on the temporary project; the root option is always supplied. */
function run(...args: string[]): Result {
	if (!args.includes("--root")) args.push("--root", root);
	const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const path = (...parts: string[]) => join(root, ...parts);
const text = (...parts: string[]) => readFileSync(path(...parts), "utf8");
const json = (...parts: string[]) => JSON.parse(text(...parts));
const PROFILE = join(PLUGIN, "profiles", "ClaudeDeck.streamDeckProfile");

/** Creates a project folder holding copies of the real package files and manifest. */
function makeProject(): void {
	root = join(base, `project-${counter++}`);
	mkdirSync(join(root, PLUGIN), { recursive: true });
	copyFileSync(join(REAL_ROOT, "package.json"), path("package.json"));
	copyFileSync(join(REAL_ROOT, "package-lock.json"), path("package-lock.json"));
	copyFileSync(join(REAL_ROOT, PLUGIN, "manifest.json"), path(PLUGIN, "manifest.json"));
}

/** Snapshot of the files that a run can change. */
function snapshot(): Record<string, string | null> {
	const files = ["package.json", "package-lock.json", join(PLUGIN, "manifest.json"), PROFILE];
	return Object.fromEntries(files.map((f) => [f, existsSync(path(f)) ? text(f) : null]));
}

beforeAll(() => {
	base = mkdtempSync(join(tmpdir(), "set-version-"));
	for (const file of REAL_FILES) before.set(file, hash(file));
});

afterAll(() => {
	rmSync(base, { recursive: true, force: true });
	for (const file of REAL_FILES) expect(hash(file)).toBe(before.get(file));
});

beforeEach(makeProject);

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("set-version files", () => {
	it("updates the package, the lockfile, and the manifest", () => {
		const result = run("0.2.0", "--no-profile");
		expect(result.status).toBe(0);
		expect(json("package.json").version).toBe("0.2.0");
		expect(json("package-lock.json").version).toBe("0.2.0");
		expect(json("package-lock.json").packages[""].version).toBe("0.2.0");
		expect(json(PLUGIN, "manifest.json").Version).toBe("0.2.0.0");
	});

	it("appends a fourth number of zero to the manifest version", () => {
		run("0.1.2", "--no-profile");
		expect(json(PLUGIN, "manifest.json").Version).toBe("0.1.2.0");
		run("12.34.56", "--no-profile");
		expect(json(PLUGIN, "manifest.json").Version).toBe("12.34.56.0");
	});

	it("leaves the other fields and their order untouched", () => {
		const keys = (value: object) => Object.keys(value);
		const pkg = json("package.json");
		const lock = json("package-lock.json");
		const manifest = json(PLUGIN, "manifest.json");
		run("7.8.9", "--no-profile");

		const newPkg = json("package.json");
		expect(keys(newPkg)).toEqual(keys(pkg));
		expect({ ...newPkg, version: pkg.version }).toEqual(pkg);

		const newLock = json("package-lock.json");
		expect(keys(newLock)).toEqual(keys(lock));
		expect(keys(newLock.packages)).toEqual(keys(lock.packages));
		expect(keys(newLock.packages[""])).toEqual(keys(lock.packages[""]));
		newLock.version = lock.version;
		newLock.packages[""].version = lock.packages[""].version;
		expect(newLock).toEqual(lock);

		const newManifest = json(PLUGIN, "manifest.json");
		expect(keys(newManifest)).toEqual(keys(manifest));
		expect({ ...newManifest, Version: manifest.Version }).toEqual(manifest);
	});

	it("changes only the version lines of the real files", () => {
		const lines = (value: string) => value.split("\n");
		const original = {
			pkg: text("package.json"),
			lock: text("package-lock.json"),
			manifest: text(PLUGIN, "manifest.json"),
		};
		run("3.2.1", "--no-profile");
		for (const [now, then] of [
			[text("package.json"), original.pkg],
			[text("package-lock.json"), original.lock],
			[text(PLUGIN, "manifest.json"), original.manifest],
		]) {
			const a = lines(now);
			const b = lines(then);
			expect(a.length).toBe(b.length);
			const changed = a.filter((line, i) => line !== b[i]);
			expect(changed.length).toBeGreaterThan(0);
			for (const line of changed) expect(line).toMatch(/"[Vv]ersion"/);
		}
	});

	it("writes files with two-space indentation", () => {
		writeFileSync(path("package.json"), JSON.stringify({ name: "x", version: "0.1.0", nested: { a: [1, 2] } }, null, "\t") + "\n");
		run("0.5.0", "--no-profile");
		expect(text("package.json")).toBe(JSON.stringify({ name: "x", version: "0.5.0", nested: { a: [1, 2] } }, null, 2) + "\n");
		expect(text("package.json")).toContain('\n  "name"');
		expect(text("package.json")).not.toContain("\t");
	});

	it("keeps the final newline of package.json when present", () => {
		writeFileSync(path("package.json"), '{\n  "name": "x",\n  "version": "0.1.0"\n}\n');
		run("0.3.0", "--no-profile");
		expect(text("package.json")).toBe('{\n  "name": "x",\n  "version": "0.3.0"\n}\n');
	});

	it("leaves package.json without a final newline when it has none", () => {
		writeFileSync(path("package.json"), '{\n  "name": "x",\n  "version": "0.1.0"\n}');
		run("0.3.0", "--no-profile");
		expect(text("package.json")).toBe('{\n  "name": "x",\n  "version": "0.3.0"\n}');
	});

	it("keeps the manifest without a final newline", () => {
		const original = text(PLUGIN, "manifest.json");
		writeFileSync(path(PLUGIN, "manifest.json"), original.replace(/\n$/, ""));
		run("0.3.0", "--no-profile");
		expect(text(PLUGIN, "manifest.json").endsWith("\n")).toBe(false);
		expect(text(PLUGIN, "manifest.json").endsWith("}")).toBe(true);
	});

	it("keeps the manifest final newline when present", () => {
		const original = text(PLUGIN, "manifest.json");
		writeFileSync(path(PLUGIN, "manifest.json"), original.replace(/\n*$/, "\n"));
		run("0.3.0", "--no-profile");
		expect(text(PLUGIN, "manifest.json").endsWith("}\n")).toBe(true);
		expect(text(PLUGIN, "manifest.json").endsWith("\n\n")).toBe(false);
	});

	it("keeps the lockfile final newline or lack of one", () => {
		const original = text("package-lock.json").replace(/\n*$/, "");
		writeFileSync(path("package-lock.json"), original + "\n");
		run("0.3.0", "--no-profile");
		expect(text("package-lock.json").endsWith("}\n")).toBe(true);
		writeFileSync(path("package-lock.json"), original);
		run("0.4.0", "--no-profile");
		expect(text("package-lock.json").endsWith("}")).toBe(true);
	});

	it("updates the other files when the lockfile is missing", () => {
		rmSync(path("package-lock.json"));
		const result = run("0.2.0", "--no-profile");
		expect(result.status).toBe(0);
		expect(existsSync(path("package-lock.json"))).toBe(false);
		expect(json("package.json").version).toBe("0.2.0");
		expect(json(PLUGIN, "manifest.json").Version).toBe("0.2.0.0");
	});

	it("updates the top-level lockfile version when the lockfile has no root package entry", () => {
		writeFileSync(path("package-lock.json"), JSON.stringify({ name: "x", version: "0.1.0", lockfileVersion: 3, packages: { "node_modules/a": { version: "1.0.0" } } }, null, 2) + "\n");
		const result = run("0.2.0", "--no-profile");
		expect(result.status).toBe(0);
		const lock = json("package-lock.json");
		expect(lock.version).toBe("0.2.0");
		expect(lock.packages).toEqual({ "node_modules/a": { version: "1.0.0" } });
	});

	it("updates a lockfile that has no packages section", () => {
		writeFileSync(path("package-lock.json"), JSON.stringify({ name: "x", version: "0.1.0", lockfileVersion: 1 }, null, 2) + "\n");
		const result = run("0.2.0", "--no-profile");
		expect(result.status).toBe(0);
		expect(json("package-lock.json")).toEqual({ name: "x", version: "0.2.0", lockfileVersion: 1 });
	});

	it("does not change dependency versions in the lockfile", () => {
		const lock = json("package-lock.json");
		run("0.9.9", "--no-profile");
		const next = json("package-lock.json");
		for (const [name, entry] of Object.entries<{ version?: string }>(lock.packages)) {
			if (name === "") continue;
			expect(next.packages[name].version).toBe(entry.version);
		}
	});

	it("is idempotent for the same version", () => {
		run("0.2.0");
		const first = snapshot();
		const bytes = readFileSync(path(PROFILE));
		const result = run("0.2.0");
		expect(result.status).toBe(0);
		expect(snapshot()).toEqual(first);
		expect(readFileSync(path(PROFILE)).equals(bytes)).toBe(true);
	});

	it("prints the version and the manifest version on the last line", () => {
		const result = run("0.2.0", "--no-profile");
		expect(result.stdout.trimEnd().split("\n").pop()).toBe("Version set to 0.2.0 (manifest 0.2.0.0)");
		expect(result.stdout.endsWith("\n")).toBe(true);
	});

	it("prints the version summary last when the profile is rebuilt", () => {
		const result = run("0.2.0");
		expect(result.status).toBe(0);
		expect(result.stdout.trimEnd().split("\n").pop()).toBe("Version set to 0.2.0 (manifest 0.2.0.0)");
	});
});

describe("set-version profile", () => {
	it("writes a valid profile archive in the plugin folder of the root", () => {
		expect(existsSync(path(PROFILE))).toBe(false);
		const result = run("0.2.0");
		expect(result.status).toBe(0);
		expect(existsSync(path(PROFILE))).toBe(true);
		const archive = readZip(readFileSync(path(PROFILE)));
		expect(archive.entries.length).toBeGreaterThan(0);
		expect(archive.totalEntries).toBe(archive.entries.length);
	});

	it("records the new manifest version on every action", () => {
		run("0.2.0");
		const archive = readZip(readFileSync(path(PROFILE)));
		const page = archive.entries.find((e) => /^[^/]+\.sdProfile\/Profiles\/[^/]+\/manifest\.json$/.test(e.name));
		expect(page).toBeDefined();
		const controllers = JSON.parse(page!.data.toString("utf8")).Controllers as { Actions: Record<string, { Plugin: { Version: string } }> }[];
		const actions = controllers.flatMap((c) => Object.values(c.Actions));
		expect(actions.length).toBeGreaterThan(0);
		for (const action of actions) {
			expect(action.Plugin.Version).toBe("0.2.0.0");
		}
	});

	it("records a different version when it is run again with another version", () => {
		run("0.2.0");
		const first = readFileSync(path(PROFILE));
		run("0.3.1");
		const second = readFileSync(path(PROFILE));
		expect(second.equals(first)).toBe(false);
		expect(second.toString("latin1")).toContain("0.3.1.0");
		expect(second.toString("latin1")).not.toContain("0.2.0.0");
	});

	it("does not create a profile with --no-profile", () => {
		const result = run("0.2.0", "--no-profile");
		expect(result.status).toBe(0);
		expect(existsSync(path(PLUGIN, "profiles"))).toBe(false);
		expect(existsSync(path(PROFILE))).toBe(false);
	});

	it("accepts --no-profile before the version", () => {
		const result = run("--no-profile", "0.2.0");
		expect(result.status).toBe(0);
		expect(existsSync(path(PROFILE))).toBe(false);
		expect(json("package.json").version).toBe("0.2.0");
	});

	it("does not rebuild an existing profile with --no-profile", () => {
		run("0.2.0");
		const bytes = readFileSync(path(PROFILE));
		run("0.3.0", "--no-profile");
		expect(readFileSync(path(PROFILE)).equals(bytes)).toBe(true);
	});
});

describe("set-version arguments", () => {
	it("accepts the version before --root", () => {
		const result = run("0.2.0", "--root", root, "--no-profile");
		expect(result.status).toBe(0);
		expect(json("package.json").version).toBe("0.2.0");
	});

	it("accepts the version after --root", () => {
		const result = run("--root", root, "0.2.0", "--no-profile");
		expect(result.status).toBe(0);
		expect(json("package.json").version).toBe("0.2.0");
	});

	it("accepts the version after --no-profile and --root", () => {
		const result = run("--no-profile", "--root", root, "0.2.0");
		expect(result.status).toBe(0);
		expect(json(PLUGIN, "manifest.json").Version).toBe("0.2.0.0");
	});

	it("accepts a root folder with a trailing separator", () => {
		const result = run("0.2.0", "--root", root + "/", "--no-profile");
		expect(result.status).toBe(0);
		expect(json("package.json").version).toBe("0.2.0");
	});

	it("accepts a relative root folder", () => {
		const result = spawnSync(process.execPath, [SCRIPT, "0.2.0", "--root", ".", "--no-profile"], { encoding: "utf8", cwd: root });
		expect(result.status).toBe(0);
		expect(json("package.json").version).toBe("0.2.0");
	});

	it.each(["1.2", "1.2.3.4", "v1.2.3", "1.2.3-beta", "", "abc", "1.2.x", "1.2.3 ", " 1.2.3", "-1.2.3", "1..3"])(
		"rejects the version %j with exit code 2 and changes nothing",
		(version) => {
			const original = snapshot();
			const result = run(version, "--no-profile");
			expect(result.status).toBe(2);
			expect(result.stderr).toContain("Usage");
			expect(result.stderr).toContain("MAJOR.MINOR.PATCH");
			expect(result.stdout).toBe("");
			expect(snapshot()).toEqual(original);
		},
	);

	it("rejects a missing version with exit code 2 and changes nothing", () => {
		const original = snapshot();
		const result = run("--no-profile");
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("Usage");
		expect(snapshot()).toEqual(original);
	});

	it("rejects a missing version when the profile would be rebuilt", () => {
		const original = snapshot();
		const result = run();
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("Usage");
		expect(snapshot()).toEqual(original);
		expect(existsSync(path(PROFILE))).toBe(false);
	});

	it("fails for a root folder without a manifest", () => {
		rmSync(path(PLUGIN, "manifest.json"));
		const result = run("0.2.0", "--no-profile");
		expect(result.status).not.toBe(0);
		expect(result.stderr).not.toBe("");
		expect(existsSync(path(PROFILE))).toBe(false);
	});

	it("fails for a root folder without a manifest when the profile would be rebuilt", () => {
		rmSync(path(PLUGIN), { recursive: true, force: true });
		const result = run("0.2.0");
		expect(result.status).not.toBe(0);
		expect(existsSync(path(PROFILE))).toBe(false);
		expect(result.stdout).not.toContain("Version set to");
	});

	it("fails for a root folder without a package.json", () => {
		rmSync(path("package.json"));
		const result = run("0.2.0", "--no-profile");
		expect(result.status).not.toBe(0);
		expect(result.stdout).not.toContain("Version set to");
	});

	it("fails for a package.json that is not valid JSON and leaves it as it was", () => {
		writeFileSync(path("package.json"), "{ not json");
		const result = run("0.2.0", "--no-profile");
		expect(result.status).not.toBe(0);
		expect(text("package.json")).toBe("{ not json");
	});
});

describe("set-version failures", () => {
	it("changes nothing when the manifest is missing", () => {
		rmSync(path(PLUGIN, "manifest.json"));
		const files = snapshot();
		const result = run("0.2.0", "--no-profile");
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Nothing was changed");
		expect(snapshot()).toEqual(files);
	});

	it("changes nothing when the manifest is not valid JSON", () => {
		writeFileSync(path(PLUGIN, "manifest.json"), "{ not json");
		const files = snapshot();
		const result = run("0.2.0", "--no-profile");
		expect(result.status).toBe(1);
		expect(snapshot()).toEqual(files);
	});

	it("changes nothing when the lockfile is not valid JSON", () => {
		writeFileSync(path("package-lock.json"), "{ not json");
		const files = snapshot();
		const result = run("0.2.0", "--no-profile");
		expect(result.status).toBe(1);
		expect(snapshot()).toEqual(files);
	});

	it("changes nothing when package.json is not valid JSON", () => {
		writeFileSync(path("package.json"), "not json");
		const files = snapshot();
		const result = run("0.2.0", "--no-profile");
		expect(result.status).toBe(1);
		expect(snapshot()).toEqual(files);
	});

	it("changes nothing when package.json is missing", () => {
		rmSync(path("package.json"));
		const files = snapshot();
		const result = run("0.2.0", "--no-profile");
		expect(result.status).toBe(1);
		expect(snapshot()).toEqual(files);
	});

	it("does not write the profile when a file could not be read", () => {
		rmSync(path(PLUGIN, "manifest.json"));
		run("0.2.0");
		expect(existsSync(path(PROFILE))).toBe(false);
	});
});
