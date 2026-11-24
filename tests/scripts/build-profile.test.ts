import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parsePrompts } from "../../src/actions/saved-prompts";
import { parseSequence } from "../../src/input/sequence";
import { readZip, type ZipArchive, type ZipEntry } from "../helpers/zip";

const ROOT = resolve(__dirname, "../..");
const SCRIPT = join(ROOT, "scripts/build-profile.mjs");
const PLUGIN_DIR = join(ROOT, "com.claudedeck.controls.sdPlugin");
const COMMITTED = join(PLUGIN_DIR, "profiles/ClaudeDeck.streamDeckProfile");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;

type Action = {
	ActionID: string;
	LinkedTitle: boolean;
	Name: string;
	Plugin: { Name: string; UUID: string; Version: string };
	Resources: unknown;
	Settings: Record<string, unknown>;
	State: number;
	States: Record<string, unknown>[];
	UUID: string;
};
type Controller = { Type: string; Actions: Record<string, Action> };

let dir: string;
let output: string;
let stdout: string;
let bytes: Buffer;
let archive: ZipArchive;

/** Builds the profile into a path inside the temporary directory; any other path is rejected. */
function build(target: string): { status: number | null; stdout: string; stderr: string } {
	if (!resolve(target).startsWith(resolve(dir))) {
		throw new Error("the output path must be inside the temporary directory");
	}
	const result = spawnSync(process.execPath, [SCRIPT, target], { encoding: "utf8" });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const entry = (name: string): ZipEntry => {
	const found = archive.entries.find((e) => e.name === name);
	if (!found) throw new Error(`missing entry ${name}`);
	return found;
};
const parse = (name: string): any => JSON.parse(entry(name).data.toString("utf8"));

const profileFolder = (): string => {
	const manifest = archive.entries.find((e) => /^[^/]+\.sdProfile\/manifest\.json$/.test(e.name));
	if (!manifest) throw new Error("profile manifest missing");
	return manifest.name.slice(0, manifest.name.indexOf("/") + 1);
};
const profileManifest = (): any => parse(`${profileFolder()}manifest.json`);
const pageId = (): string => profileManifest().Pages.Default;
const pageFolder = (): string => `${profileFolder()}Profiles/${pageId().toUpperCase()}/`;
const controllers = (): Controller[] => parse(`${pageFolder()}manifest.json`).Controllers;
const controller = (type: string): Controller => controllers().find((c) => c.Type === type) as Controller;
const allActions = (): Action[] => controllers().flatMap((c) => Object.values(c.Actions));
const pluginManifest = (): any => JSON.parse(readFileSync(join(PLUGIN_DIR, "manifest.json"), "utf8"));

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "build-profile-"));
	output = join(dir, "out", "nested", "profile.streamDeckProfile");
	const result = build(output);
	if (result.status !== 0) throw new Error(`build failed: ${result.stderr}`);
	stdout = result.stdout;
	bytes = readFileSync(output);
	archive = readZip(bytes);
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("build-profile archive structure", () => {
	it("creates the output directory when it does not exist", () => {
		expect(existsSync(output)).toBe(true);
	});

	it("starts with a local file header and ends with an end-of-central-directory record", () => {
		expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
		expect(bytes.readUInt32LE(bytes.length - 22)).toBe(0x06054b50);
	});

	it("records the same entry count in the central directory and the end record", () => {
		expect(archive.totalEntries).toBe(archive.entries.length);
		expect(archive.diskEntries).toBe(archive.entries.length);
	});

	it("reads every entry with matching local headers and CRC-32 values", () => {
		expect(() => readZip(bytes)).not.toThrow();
	});

	it("places the local headers one after another starting at offset 0", () => {
		let offset = 0;
		for (const e of archive.entries) {
			expect(e.offset).toBe(offset);
			offset += 30 + Buffer.byteLength(e.name) + e.data.length;
		}
	});

	it("detects a corrupted entry", () => {
		const first = archive.entries.find((e) => !e.isDirectory) as ZipEntry;
		const damaged = Buffer.from(bytes);
		const start = first.offset + 30 + Buffer.byteLength(first.name);
		damaged[start] = (damaged[start] ?? 0) ^ 0xff;
		expect(() => readZip(damaged)).toThrow(/CRC-32/);
	});

	it("uses forward slashes in every name", () => {
		for (const e of archive.entries) {
			expect(e.name).not.toContain("\\");
			expect(e.name.startsWith("/")).toBe(false);
		}
	});

	it("sets the UTF-8 name flag on every entry", () => {
		for (const e of archive.entries) {
			expect(e.flags & 0x0800).toBe(0x0800);
		}
	});

	it("ends directory names with a slash and gives them no data", () => {
		const directories = archive.entries.filter((e) => e.isDirectory);
		expect(directories).toHaveLength(2);
		for (const d of directories) {
			expect(d.name.endsWith("/")).toBe(true);
			expect(d.data.length).toBe(0);
		}
		for (const e of archive.entries.filter((x) => !x.isDirectory)) {
			expect(e.name.endsWith("/")).toBe(false);
			expect(e.data.length).toBeGreaterThan(0);
		}
	});

	it("contains exactly the profile and page manifests and their image folders", () => {
		const folder = profileFolder();
		expect(folder).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-A[0-9A-F]{3}-[0-9A-F]{12}\.sdProfile\/$/);
		const page = pageFolder();
		expect(archive.entries.map((e) => e.name).sort()).toEqual(
			[`${folder}manifest.json`, `${folder}Images/`, `${page}manifest.json`, `${page}Images/`].sort(),
		);
		expect(entry(`${folder}Images/`).isDirectory).toBe(true);
		expect(entry(`${page}Images/`).isDirectory).toBe(true);
	});

	it("reports the entry, key, and dial counts on standard output", () => {
		expect(archive.entries).toHaveLength(4);
		expect(stdout).toContain(`Wrote ${resolve(output)} (4 entries, 8 keys, 4 dials)`);
	});
});

describe("build-profile manifests", () => {
	it("describes a Stream Deck + profile named Claude Deck", () => {
		const manifest = profileManifest();
		expect(manifest.Device).toEqual({ Model: "20GBD9901", UUID: "" });
		expect(manifest.Name).toBe("Claude Deck");
		expect(manifest.Version).toBe("3.0");
	});

	it("lists a single page that is both current and default", () => {
		const { Pages } = profileManifest();
		expect(Pages.Pages).toEqual([Pages.Default]);
		expect(Pages.Current).toBe(Pages.Default);
		expect(Pages.Default).toMatch(UUID_PATTERN);
	});

	it("names the page folder after the page id in upper case", () => {
		expect(pageFolder()).toBe(`${profileFolder()}Profiles/${pageId().toUpperCase()}/`);
		expect(pageId()).toBe(pageId().toLowerCase());
		expect(() => entry(`${pageFolder()}manifest.json`)).not.toThrow();
	});

	it("gives the page a Keypad and an Encoder controller with an empty icon and name", () => {
		const page = parse(`${pageFolder()}manifest.json`);
		expect(page.Controllers.map((c: Controller) => c.Type)).toEqual(["Keypad", "Encoder"]);
		expect(page.Icon).toBe("");
		expect(page.Name).toBe("");
	});
});

describe("build-profile layout", () => {
	it("places 8 keys at columns 0-3 of rows 0-1", () => {
		const positions = Object.keys(controller("Keypad").Actions);
		expect(positions).toHaveLength(8);
		expect([...positions].sort()).toEqual(["0,0", "0,1", "1,0", "1,1", "2,0", "2,1", "3,0", "3,1"]);
	});

	it("places 4 dials at columns 0-3 of row 0", () => {
		expect(Object.keys(controller("Encoder").Actions).sort()).toEqual(["0,0", "1,0", "2,0", "3,0"]);
	});

	const summarize = (type: string) =>
		Object.fromEntries(
			Object.entries(controller(type).Actions).map(([position, a]) => [
				position,
				{ id: a.UUID.replace("com.claudedeck.controls.", ""), settings: a.Settings },
			]),
		);

	it("arranges the keys", () => {
		expect(summarize("Keypad")).toEqual({
			"0,0": { id: "usage", settings: { first: "session", second: "week" } },
			"1,0": { id: "context", settings: { compact: true } },
			"2,0": { id: "permission-mode", settings: {} },
			"3,0": { id: "connection", settings: {} },
			"0,1": { id: "permission", settings: { response: "allow" } },
			"1,1": { id: "send-text", settings: { text: "yes", submit: true } },
			"2,1": { id: "send-text", settings: { text: "/graphify", submit: true } },
			"3,1": { id: "claude-status", settings: {} },
		});
	});

	it("arranges the dials", () => {
		expect(summarize("Encoder")).toEqual({
			"0,0": { id: "session-overview", settings: {} },
			"1,0": { id: "saved-prompts", settings: { prompts: "Yes\n1\ncommit\n{Clipboard}\n/graphify\n/exit", submit: true } },
			"2,0": { id: "usage", settings: { first: "session", second: "week" } },
			"3,0": { id: "model-picker", settings: { models: "opus\nsonnet\nhaiku" } },
		});
	});

	it("gives every action the full set of fields", () => {
		const version = pluginManifest().Version;
		expect(version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
		expect(allActions()).toHaveLength(12);
		for (const a of allActions()) {
			expect(Object.keys(a).sort()).toEqual([
				"ActionID",
				"LinkedTitle",
				"Name",
				"Plugin",
				"Resources",
				"Settings",
				"State",
				"States",
				"UUID",
			]);
			expect(a.ActionID).toMatch(UUID_PATTERN);
			expect(typeof a.LinkedTitle).toBe("boolean");
			expect(a.Name.length).toBeGreaterThan(0);
			expect(a.Plugin).toEqual({ Name: "Claude Deck", UUID: "com.claudedeck.controls", Version: version });
			expect(a.Resources).toBeNull();
			expect(typeof a.Settings).toBe("object");
			expect(a.State).toBe(0);
			expect(a.States).toHaveLength(1);
		}
	});

	it("uses a unique ActionID for every action", () => {
		const ids = allActions().map((a) => a.ActionID);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("shows titles at the bottom of the two Send Text keys and nowhere else", () => {
		const keys = controller("Keypad").Actions;
		for (const [position, title] of [
			["1,1", "yes"],
			["2,1", "/graphify"],
		] as const) {
			const state = (keys[position] as Action).States[0] as Record<string, unknown>;
			expect(state.Title).toBe(title);
			expect(state.ShowTitle).toBe(true);
			expect(state.TitleAlignment).toBe("bottom");
		}
		for (const a of allActions()) {
			if (a.UUID.endsWith(".send-text")) continue;
			expect(a.States).toEqual([{}]);
		}
	});
});

describe("build-profile determinism", () => {
	it("produces byte-identical files on repeated builds", () => {
		const second = join(dir, "second", "profile.streamDeckProfile");
		const third = join(dir, "third.streamDeckProfile");
		expect(build(second).status).toBe(0);
		expect(build(third).status).toBe(0);
		expect(readFileSync(second).equals(bytes)).toBe(true);
		expect(readFileSync(third).equals(bytes)).toBe(true);
	});

	it("matches the committed profile file", () => {
		expect(readFileSync(COMMITTED).equals(bytes)).toBe(true);
	});
});

describe("build-profile and the plugin manifest", () => {
	it("only places actions that the manifest declares", () => {
		const declared = pluginManifest().Actions.map((a: { UUID: string }) => a.UUID);
		for (const a of allActions()) {
			expect(declared).toContain(a.UUID);
		}
	});

	it("lists the matching controller in the manifest for every placement", () => {
		const actions = pluginManifest().Actions as { UUID: string; Controllers?: string[] }[];
		for (const type of ["Keypad", "Encoder"]) {
			for (const placed of Object.values(controller(type).Actions)) {
				const declared = actions.find((a) => a.UUID === placed.UUID);
				expect(declared?.Controllers ?? ["Keypad"]).toContain(type);
			}
		}
	});

	it("is referenced by the manifest as a Stream Deck + profile that exists", () => {
		const profiles = pluginManifest().Profiles as { Name: string; DeviceType: number }[];
		expect(profiles).toHaveLength(1);
		expect(profiles[0]?.Name).toBe("profiles/ClaudeDeck");
		expect(profiles[0]?.DeviceType).toBe(7);
		expect(profileManifest().Device.Model).toBe("20GBD9901");
		expect(existsSync(join(PLUGIN_DIR, `${profiles[0]?.Name}.streamDeckProfile`))).toBe(true);
	});

	it("matches the plugin identity and version", () => {
		const manifest = pluginManifest();
		for (const a of allActions()) {
			expect(a.Plugin.UUID).toBe(manifest.UUID);
			expect(a.Plugin.Name).toBe(manifest.Name);
			expect(a.Plugin.Version).toBe(manifest.Version);
			expect(a.UUID.startsWith(`${manifest.UUID}.`)).toBe(true);
		}
	});
});

describe("build-profile settings accepted by the code", () => {
	it("gives the saved prompts dial the six prompts in order", () => {
		const settings = controller("Encoder").Actions["1,0"]?.Settings ?? {};
		expect(parsePrompts(settings).map((p) => p.text)).toEqual(["Yes", "1", "commit", "{Clipboard}", "/graphify", "/exit"]);
	});

	it("parses every Send Text sequence and saved prompt", () => {
		const sends = allActions().filter((a) => a.UUID.endsWith(".send-text"));
		expect(sends).toHaveLength(2);
		for (const a of sends) {
			expect(() => parseSequence(a.Settings.text as string, a.Settings.submit === true)).not.toThrow();
		}
		for (const prompt of parsePrompts(controller("Encoder").Actions["1,0"]?.Settings ?? {})) {
			expect(() => parseSequence(prompt.text, true)).not.toThrow();
		}
	});

	it("uses valid usage window names", () => {
		const usage = allActions().filter((a) => a.UUID.endsWith(".usage"));
		expect(usage).toHaveLength(2);
		for (const a of usage) {
			expect(["session", "week", "sonnet"]).toContain(a.Settings.first);
			expect(["session", "week", "sonnet"]).toContain(a.Settings.second);
		}
	});

	it("uses a valid permission response", () => {
		const permission = allActions().filter((a) => a.UUID.endsWith(".permission"));
		expect(permission).toHaveLength(1);
		expect(["allow", "always", "deny"]).toContain(permission[0]?.Settings.response);
	});
});
