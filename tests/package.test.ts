import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");
const json = (path: string): any => JSON.parse(read(path));

const pkg = json("package.json");
const lock = json("package-lock.json");
const manifest = json("com.claudedeck.controls.sdPlugin/manifest.json");

describe("version", () => {
	it("is the same in package.json and the lockfile", () => {
		expect(lock.version).toBe(pkg.version);
		expect(lock.packages[""].version).toBe(pkg.version);
	});

	it("is the package version with a fourth component in the plugin manifest", () => {
		expect(manifest.Version).toBe(`${pkg.version}.0`);
	});

	it("is a three-part version number", () => {
		expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
	});
});

describe("license", () => {
	it("is declared as MIT in package.json", () => {
		expect(pkg.license).toBe("MIT");
	});

	it("has a LICENSE file with the MIT text and a copyright line", () => {
		expect(existsSync(resolve(ROOT, "LICENSE"))).toBe(true);
		const text = read("LICENSE");
		expect(text.startsWith("MIT License")).toBe(true);
		expect(text).toMatch(/^Copyright \(c\) \d{4} \S+/m);
		expect(text).toContain("Permission is hereby granted, free of charge");
	});

	it("is named in the README license section and badge", () => {
		const readme = read("README.md");
		expect(readme).toContain("badge/license-MIT-");
		expect(readme).toMatch(/## License\s+MIT\. See \[LICENSE\]\(LICENSE\)/);
	});
});

describe("scripts", () => {
	it("packages by building, validating, and packing into dist", () => {
		const script: string = pkg.scripts.package;
		expect(script).toContain("npm run build");
		expect(script).toContain("npm run validate");
		expect(script).toContain("streamdeck pack com.claudedeck.controls.sdPlugin");
		expect(script).toContain("--output dist");
		expect(script.indexOf("npm run build")).toBeLessThan(script.indexOf("npm run validate"));
		expect(script.indexOf("npm run validate")).toBeLessThan(script.indexOf("streamdeck pack"));
	});

	it("validates the plugin folder", () => {
		expect(pkg.scripts.validate).toBe("streamdeck validate com.claudedeck.controls.sdPlugin");
	});

	it.each(["build", "typecheck", "test", "package", "validate", "profile:build", "hooks:install", "hooks:remove", "statusline:install"])(
		"defines %s",
		(name) => {
			expect(typeof pkg.scripts[name]).toBe("string");
		},
	);

	it("runs the installer and profile scripts at paths that exist", () => {
		for (const name of ["hooks:install", "hooks:remove", "statusline:install", "profile:build"]) {
			const path = /node (\S+\.mjs)/.exec(pkg.scripts[name])?.[1] as string;
			expect(existsSync(resolve(ROOT, path)), `${name}: ${path}`).toBe(true);
		}
	});
});

describe(".gitignore", () => {
	const lines = read(".gitignore").split(/\r?\n/);

	it.each(["dist/", "node_modules/", "*.sdPlugin/bin/", "*.sdPlugin/logs/", "*.streamDeckPlugin"])("ignores %s", (entry) => {
		expect(lines).toContain(entry);
	});

	it("ignores the Claude configuration files", () => {
		for (const entry of ["CLAUDE.md", "CLAUDE.local.md", ".claude/", ".mcp.json"]) {
			expect(lines).toContain(entry);
		}
	});
});
