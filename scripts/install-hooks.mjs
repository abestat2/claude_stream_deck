// Adds or removes the hook entries that send Claude Code session events to the plugin.
//
// Usage:
//   node scripts/install-hooks.mjs            add the hooks to the user settings file
//   node scripts/install-hooks.mjs --remove   remove the hooks
//   node scripts/install-hooks.mjs --port N   use a different receiver port (default 47831)
//   node scripts/install-hooks.mjs --file P   edit the settings file at path P
//
// Entries are identified by their URL, so running the script repeatedly is safe and
// all other settings and hooks in the file are left unchanged.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PermissionDenied",
  "Notification",
  "Elicitation",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
];

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const port = Number(option("--port") ?? 47831);
const file = option("--file") ?? join(homedir(), ".claude", "settings.json");
const url = `http://127.0.0.1:${port}/event`;

const settings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const hooks = settings.hooks ?? {};

const isOurs = (hook) => hook?.type === "http" && hook.url === url;

for (const event of Object.keys(hooks)) {
  hooks[event] = hooks[event]
    .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((hook) => !isOurs(hook)) }))
    .filter((group) => group.hooks.length > 0);
  if (hooks[event].length === 0) {
    delete hooks[event];
  }
}

if (!remove) {
  for (const event of EVENTS) {
    hooks[event] = [...(hooks[event] ?? []), { hooks: [{ type: "http", url, timeout: 2 }] }];
  }
}

if (Object.keys(hooks).length > 0) {
  settings.hooks = hooks;
} else {
  delete settings.hooks;
}

if (existsSync(file)) {
  copyFileSync(file, `${file}.bak`);
}
writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
console.log(`${remove ? "Removed hooks from" : "Installed hooks in"} ${file}`);
