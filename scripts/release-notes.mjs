// Prints the changelog section for one version.
//
// Usage: node scripts/release-notes.mjs <version> [changelog file]
//
// The section starts at the heading "## <version>" (optionally followed by a space and a date) and ends
// before the next "## " heading. Exits with an error when the version has no section or the section is empty.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
const file = process.argv[3] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../CHANGELOG.md");

if (!version) {
  console.error("Usage: node scripts/release-notes.mjs <version> [changelog file]");
  process.exit(2);
}

const lines = readFileSync(file, "utf8").split(/\r?\n/);
const isHeadingForVersion = (line) => line.trimEnd() === `## ${version}` || line.startsWith(`## ${version} `);

const start = lines.findIndex(isHeadingForVersion);
if (start === -1) {
  console.error(`No changelog section for version ${version}`);
  process.exit(1);
}

let end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
if (end === -1) {
  end = lines.length;
}

const notes = lines.slice(start + 1, end).join("\n").trim();
if (!notes) {
  console.error(`The changelog section for version ${version} is empty`);
  process.exit(1);
}
console.log(notes);
