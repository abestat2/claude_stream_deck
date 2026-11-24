// Sets the plugin version everywhere it is stored.
//
// Usage: node scripts/set-version.mjs <MAJOR.MINOR.PATCH> [--root <project folder>] [--no-profile]
//
// Updates package.json, the lockfile, and the plugin manifest, which holds the version with a fourth number
// (0.1.2 becomes 0.1.2.0), and then rebuilds the preset profile so it carries the same plugin version.
// --root works on another project folder, for example a copy. --no-profile skips the profile rebuild.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const version = args.find((arg) => /^\d+\.\d+\.\d+$/.test(arg));
if (!version) {
  console.error("Usage: node scripts/set-version.mjs <MAJOR.MINOR.PATCH> [--root <project folder>] [--no-profile]");
  process.exit(2);
}

const root = resolve(option("--root") ?? join(here, ".."));
const pluginFolder = join(root, "com.claudedeck.controls.sdPlugin");

/**
 * Reads and parses a JSON file and applies a change to it, without writing anything.
 * Returns a function that writes the changed file with two-space indentation, keeping its final newline
 * or lack of one.
 */
function prepare(path, change) {
  const text = readFileSync(path, "utf8");
  const data = JSON.parse(text);
  change(data);
  return () => writeFileSync(path, JSON.stringify(data, null, 2) + (text.endsWith("\n") ? "\n" : ""));
}

const manifest = join(pluginFolder, "manifest.json");
const lockfile = join(root, "package-lock.json");

// Every file is read and parsed before any file is written, so a missing or damaged file changes nothing.
let writes;
try {
  writes = [
    prepare(join(root, "package.json"), (data) => {
      data.version = version;
    }),
    ...(existsSync(lockfile)
      ? [
          prepare(lockfile, (data) => {
            data.version = version;
            if (data.packages?.[""]) {
              data.packages[""].version = version;
            }
          }),
        ]
      : []),
    prepare(manifest, (data) => {
      data.Version = `${version}.0`;
    }),
  ];
} catch (error) {
  console.error(`Nothing was changed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
for (const write of writes) {
  write();
}

if (!args.includes("--no-profile")) {
  execFileSync(
    process.execPath,
    [join(here, "build-profile.mjs"), join(pluginFolder, "profiles", "ClaudeDeck.streamDeckProfile"), manifest],
    { stdio: "inherit" },
  );
}

console.log(`Version set to ${version} (manifest ${version}.0)`);
