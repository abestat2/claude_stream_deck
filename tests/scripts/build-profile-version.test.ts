import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readZip, type ZipArchive } from "../helpers/zip";

const ROOT = resolve(__dirname, "../..");
const SCRIPT = join(ROOT, "scripts/build-profile.mjs");
const REAL_MANIFEST = join(ROOT, "com.claudedeck.controls.sdPlugin/manifest.json");
const REAL_VERSION: string = JSON.parse(readFileSync(REAL_MANIFEST, "utf8")).Version;

let dir: string;
let counter = 0;

type Result = { status: number | null; stdout: string; stderr: string; output: string };

/** Builds the profile into a new temporary output path, optionally with a manifest file as the second argument. */
function build(manifest?: string): Result {
	const output = join(dir, `out-${counter++}`, "profile.streamDeckProfile");
	const result = spawnSync(process.execPath, [SCRIPT, output, ...(manifest === undefined ? [] : [manifest])], { encoding: "utf8" });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr, output };
}

/** Writes a temporary manifest with the given content. */
function manifestFile(content: string | object): string {
	const file = join(dir, `manifest-${counter++}.json`);
	writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
	return file;
}

/** Builds the profile and returns the archive bytes. */
function bytesOf(manifest?: string): Buffer {
	const result = build(manifest);
	if (result.status !== 0) throw new Error(`build failed: ${result.stderr}`);
	return readFileSync(result.output);
}

/** The actions in the page manifest of an archive. */
function actionsOf(archive: ZipArchive): { Plugin: { Name: string; UUID: string; Version?: string } }[] {
	const page = archive.entries.find((e) => /^[^/]+\.sdProfile\/Profiles\/[^/]+\/manifest\.json$/.test(e.name));
	if (!page) throw new Error("page manifest missing");
	const controllers = JSON.parse(page.data.toString("utf8")).Controllers as { Actions: Record<string, never> }[];
	return controllers.flatMap((c) => Object.values(c.Actions));
}

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "build-profile-version-"));
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("build-profile manifest argument", () => {
	it("records the version of the given manifest on every action", () => {
		const archive = readZip(bytesOf(manifestFile({ Version: "9.8.7.6" })));
		const actions = actionsOf(archive);
		expect(actions.length).toBeGreaterThan(0);
		for (const action of actions) {
			expect(action.Plugin.Version).toBe("9.8.7.6");
		}
	});

	it("keeps the other plugin fields when the manifest has more fields", () => {
		const archive = readZip(bytesOf(manifestFile({ Name: "Other", UUID: "other.plugin", Version: "2.0.0.0" })));
		for (const action of actionsOf(archive)) {
			expect(action.Plugin).toEqual({ Name: "Claude Deck", UUID: "com.claudedeck.controls", Version: "2.0.0.0" });
		}
	});

	it("records the version of the real manifest when no manifest is given", () => {
		const archive = readZip(bytesOf());
		const actions = actionsOf(archive);
		expect(actions.length).toBeGreaterThan(0);
		for (const action of actions) {
			expect(action.Plugin.Version).toBe(REAL_VERSION);
		}
	});

	it("produces the same bytes from a manifest with the same version as the real manifest", () => {
		const fromReal = bytesOf();
		const fromTemp = bytesOf(manifestFile({ Version: REAL_VERSION }));
		const fromCopy = bytesOf(manifestFile(readFileSync(REAL_MANIFEST, "utf8")));
		expect(fromTemp.equals(fromReal)).toBe(true);
		expect(fromCopy.equals(fromReal)).toBe(true);
	});

	it("produces the same bytes when the real manifest is passed explicitly", () => {
		expect(bytesOf(REAL_MANIFEST).equals(bytesOf())).toBe(true);
	});

	it("changes the archive bytes but not the entry names or identifiers when only the version changes", () => {
		const first = bytesOf(manifestFile({ Version: "1.2.3.0" }));
		const second = bytesOf(manifestFile({ Version: "4.5.6.0" }));
		expect(first.equals(second)).toBe(false);
		expect(first.length).toBe(second.length);

		const a = readZip(first);
		const b = readZip(second);
		expect(b.entries.map((e) => e.name)).toEqual(a.entries.map((e) => e.name));

		const identifiers = (archive: ZipArchive) =>
			archive.entries
				.filter((e) => !e.isDirectory)
				.map((e) => e.data.toString("utf8").replace(/"Version":"\d+\.\d+\.\d+\.\d+"/g, '"Version":"-"'));
		expect(identifiers(b)).toEqual(identifiers(a));

		const ids = (archive: ZipArchive) => actionsOf(archive).map((x) => (x as unknown as { ActionID: string }).ActionID);
		expect(ids(b)).toEqual(ids(a));
	});

	it("reports the written file on standard output", () => {
		const result = build(manifestFile({ Version: "1.0.0.0" }));
		expect(result.status).toBe(0);
		expect(result.stdout).toContain(result.output);
	});

	it("fails and writes no output when the manifest file does not exist", () => {
		const result = build(join(dir, "missing-manifest.json"));
		expect(result.status).not.toBe(0);
		expect(result.stderr).not.toBe("");
		expect(existsSync(result.output)).toBe(false);
	});

	it("fails and writes no output when the manifest is not valid JSON", () => {
		const result = build(manifestFile("{ not json"));
		expect(result.status).not.toBe(0);
		expect(result.stderr).not.toBe("");
		expect(existsSync(result.output)).toBe(false);
	});

	it("fails and writes no output when the manifest file is empty", () => {
		const result = build(manifestFile(""));
		expect(result.status).not.toBe(0);
		expect(existsSync(result.output)).toBe(false);
	});

	it("fails with an error when the manifest has no Version field", () => {
		const result = build(manifestFile({ Name: "No version" }));
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/version/i);
		expect(existsSync(result.output)).toBe(false);
	});
});
