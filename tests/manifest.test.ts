import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const PLUGIN_DIR = join(ROOT, "com.claudedeck.controls.sdPlugin");
const ACTIONS_DIR = join(ROOT, "src/actions");

type ManifestAction = {
	Name: string;
	UUID: string;
	Icon: string;
	Tooltip?: string;
	PropertyInspectorPath?: string;
	Controllers?: string[];
	Encoder?: { layout?: string; Icon?: string };
	States?: { Image?: string }[];
};

const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, "manifest.json"), "utf8")) as {
	UUID: string;
	Icon: string;
	CategoryIcon: string;
	CodePath: string;
	SDKVersion: number;
	Software: { MinimumVersion: string };
	OS: { Platform: string }[];
	Actions: ManifestAction[];
};

const sourceFiles = readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts"));
const sources = new Map(sourceFiles.map((f) => [f, readFileSync(join(ACTIONS_DIR, f), "utf8")]));

/** Action UUID declared by an `@action` decorator, keyed by the source file that declares it. */
const decorated = new Map<string, string>();
for (const [file, text] of sources) {
	for (const match of text.matchAll(/@action\(\s*\{\s*UUID:\s*"([^"]+)"\s*\}\s*\)/g)) {
		decorated.set(match[1] as string, file);
	}
}

/** Resolves an image reference from the manifest to the file that exists, trying svg then png. */
function resolveImage(reference: string): string | undefined {
	return [".svg", ".png"].map((ext) => join(PLUGIN_DIR, reference + ext)).find((p) => existsSync(p));
}

const withPanel = manifest.Actions.filter((a) => a.PropertyInspectorPath !== undefined);

describe("manifest metadata", () => {
	it("targets SDK version 3 on Stream Deck 7.1 and Windows", () => {
		expect(manifest.SDKVersion).toBe(3);
		expect(manifest.Software.MinimumVersion).toBe("7.1");
		expect(manifest.OS.map((o) => o.Platform)).toEqual(["windows"]);
	});

	it("loads the plugin code from bin/plugin.js", () => {
		expect(manifest.CodePath).toBe("bin/plugin.js");
	});

	it("resolves the plugin icon and category icon to files", () => {
		expect(resolveImage(manifest.Icon), manifest.Icon).toBeDefined();
		expect(resolveImage(manifest.CategoryIcon), manifest.CategoryIcon).toBeDefined();
	});
});

describe("manifest actions and source", () => {
	it("declares at least one action", () => {
		expect(manifest.Actions.length).toBeGreaterThan(0);
	});

	it("has a matching @action decorator in src/actions for every manifest action", () => {
		for (const a of manifest.Actions) {
			expect(decorated.has(a.UUID), a.UUID).toBe(true);
		}
	});

	it("lists every @action decorator in src/actions in the manifest", () => {
		const declared = new Set(manifest.Actions.map((a) => a.UUID));
		for (const uuid of decorated.keys()) {
			expect(declared.has(uuid), uuid).toBe(true);
		}
		expect(declared.size).toBe(decorated.size);
	});

	it("declares each @action UUID once across src/actions", () => {
		const all = [...sources.values()].flatMap((text) => [...text.matchAll(/@action\(\s*\{\s*UUID:\s*"([^"]+)"/g)].map((m) => m[1]));
		expect(new Set(all).size).toBe(all.length);
	});

	it("uses unique UUIDs that start with the plugin UUID", () => {
		const uuids = manifest.Actions.map((a) => a.UUID);
		expect(new Set(uuids).size).toBe(uuids.length);
		for (const uuid of uuids) {
			expect(uuid.startsWith(`${manifest.UUID}.`)).toBe(true);
		}
	});

	it("uses unique action names", () => {
		const names = manifest.Actions.map((a) => a.Name);
		expect(new Set(names).size).toBe(names.length);
	});
});

describe("manifest images and layouts", () => {
	for (const a of manifest.Actions) {
		it(`resolves the images of ${a.UUID}`, () => {
			expect(resolveImage(a.Icon), a.Icon).toBeDefined();
			for (const state of a.States ?? []) {
				if (state.Image !== undefined) expect(resolveImage(state.Image), state.Image).toBeDefined();
			}
			if (a.Encoder?.Icon !== undefined) expect(resolveImage(a.Encoder.Icon), a.Encoder.Icon).toBeDefined();
		});
	}

	it("points every Encoder layout at an existing JSON file", () => {
		const layouts = manifest.Actions.filter((a) => a.Encoder?.layout !== undefined);
		expect(layouts.length).toBeGreaterThan(0);
		for (const a of layouts) {
			const file = join(PLUGIN_DIR, a.Encoder?.layout as string);
			expect(existsSync(file), file).toBe(true);
			expect(() => JSON.parse(readFileSync(file, "utf8"))).not.toThrow();
		}
	});

	it("gives every Encoder-capable action an Encoder block with layouts/canvas.json", () => {
		for (const a of manifest.Actions) {
			if (a.Controllers?.includes("Encoder")) {
				expect(a.Encoder?.layout, a.UUID).toBe("layouts/canvas.json");
			}
		}
	});

	it("gives only Encoder-capable actions an Encoder block", () => {
		for (const a of manifest.Actions) {
			if (!a.Controllers?.includes("Encoder")) {
				expect(a.Encoder, a.UUID).toBeUndefined();
			}
		}
	});

	it("lists only Keypad and Encoder controllers", () => {
		for (const a of manifest.Actions) {
			expect(a.Controllers ?? ["Keypad"], a.UUID).not.toHaveLength(0);
			for (const c of a.Controllers ?? []) expect(["Keypad", "Encoder"]).toContain(c);
		}
	});
});

describe("manifest property inspector panels", () => {
	it("has at least one panel", () => {
		expect(withPanel.length).toBeGreaterThan(0);
	});

	for (const a of withPanel) {
		const path = join(PLUGIN_DIR, a.PropertyInspectorPath as string);

		describe(a.PropertyInspectorPath as string, () => {
			it("exists", () => {
				expect(existsSync(path)).toBe(true);
			});

			const html = existsSync(path) ? readFileSync(path, "utf8") : "";

			it("loads only scripts that exist beside it", () => {
				const scripts = [...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1] as string);
				expect(scripts.length).toBeGreaterThan(0);
				for (const src of scripts) {
					expect(existsSync(join(dirname(path), src)), src).toBe(true);
				}
			});

			it("uses setting names that the action source reads", () => {
				const tags = html.match(/<sdpi-[a-z]+\b[^>]*\ssetting="[^"]+"[^>]*>/g) ?? [];
				const local = tags.filter((tag) => !/\sglobal(\s|>|=)/.test(tag)).map((tag) => /setting="([^"]+)"/.exec(tag)?.[1] as string);
				const source = sources.get(decorated.get(a.UUID) as string) as string;
				for (const name of local) {
					expect(source, name).toMatch(new RegExp(`\\b${name}\\b`));
				}
			});

			it("is referenced by exactly one action", () => {
				expect(manifest.Actions.filter((x) => x.PropertyInspectorPath === a.PropertyInspectorPath)).toHaveLength(1);
			});
		});
	}

	it("uses the expected settings in the Send Text, Usage, and Permission panels", () => {
		const names = (panel: string): string[] => {
			const html = readFileSync(join(PLUGIN_DIR, "ui", panel), "utf8");
			return [...html.matchAll(/\ssetting="([^"]+)"/g)].map((m) => m[1] as string);
		};
		expect(names("send-text.html")).toEqual(["text", "submit"]);
		expect(names("usage.html")).toEqual(["first", "second"]);
		expect(names("permission.html")).toEqual(["response", "submit"]);
		expect(sources.get("send-text.ts")).toMatch(/settings\.text/);
		expect(sources.get("usage.ts")).toMatch(/settings\.first/);
		expect(sources.get("permission.ts")).toMatch(/settings\.response/);
	});

	it("marks every setting of the global settings panel with global", () => {
		const html = readFileSync(join(PLUGIN_DIR, "ui/claude-status.html"), "utf8");
		const tags = html.match(/<sdpi-[a-z]+\b[^>]*\ssetting="[^"]+"[^>]*>/g) ?? [];
		expect(tags.length).toBeGreaterThan(0);
		for (const tag of tags) expect(tag).toMatch(/\sglobal(\s|>|=)/);
	});

	it("does not use global in panels for per-action settings", () => {
		for (const a of withPanel) {
			if (a.UUID.endsWith(".claude-status")) continue;
			const html = readFileSync(join(PLUGIN_DIR, a.PropertyInspectorPath as string), "utf8");
			expect(html, a.UUID).not.toMatch(/<sdpi-[a-z]+\b[^>]*\sglobal(\s|>|=)/);
		}
	});
});
