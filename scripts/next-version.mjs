// Chooses a version from the release tags.
//
// Usage: git tag --list "v*" | node scripts/next-version.mjs [--branch <commits>] [--package <package.json>]
//
// Reads the release tags from standard input, one per line, and prints MAJOR.MINOR.PATCH. Tags that are not
// of the form vMAJOR.MINOR.PATCH are ignored, and the latest release is the highest tag.
//
// Without --branch, the version is for a release from the main branch: the minor number of the latest release
// plus one, with patch 0 (0.1.0 becomes 0.2.0). A version in package.json that is higher is used instead, so
// raising it by hand takes effect. When there are no tags, the version in package.json is used as it is.
//
// With --branch <commits>, the version is for a build of a branch that is that many commits ahead of the main
// branch: the version of the latest release with the patch number raised by the number of commits (0.2.0 and
// 3 commits give 0.2.3). When there are no tags, the version in package.json is raised the same way.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const packagePath = option("--package") ?? resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");
const parse = (version) => /^(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const fail = (message, code) => {
  console.error(message);
  process.exit(code);
};

const packageVersion = JSON.parse(readFileSync(packagePath, "utf8")).version;
const base = typeof packageVersion === "string" ? parse(packageVersion) : undefined;
if (!base) {
  fail("package.json does not hold a MAJOR.MINOR.PATCH version", 1);
}

const releases = readFileSync(0, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .map((tag) => (tag.startsWith("v") ? parse(tag.slice(1)) : undefined))
  .filter((version) => version !== undefined)
  .sort(compare);
const latest = releases[releases.length - 1];

const branchOption = option("--branch");
if (args.includes("--branch")) {
  if (branchOption === undefined || !/^\d+$/.test(branchOption)) {
    fail("--branch needs the number of commits ahead of the main branch", 2);
  }
  const from = latest ?? base;
  console.log(`${from[0]}.${from[1]}.${from[2] + Number(branchOption)}`);
} else if (!latest) {
  console.log(base.join("."));
} else {
  const next = [latest[0], latest[1] + 1, 0];
  console.log((compare(base, next) > 0 ? base : next).join("."));
}
