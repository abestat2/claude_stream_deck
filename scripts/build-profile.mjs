// Builds the Stream Deck profile that ships with the plugin.
//
// Usage: node scripts/build-profile.mjs
//
// Writes com.claudedeck.controls.sdPlugin/profiles/ClaudeDeck.streamDeckProfile, a Stream Deck + layout
// with the plugin's actions already placed. Edit the layout below and run the script to regenerate it.
// Identifiers are derived from fixed names, so rebuilding produces the same file.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), "../com.claudedeck.controls.sdPlugin/profiles/ClaudeDeck.streamDeckProfile");

const PROFILE_NAME = "Claude Deck";

/** Device model identifier of the Stream Deck +. */
const DEVICE_MODEL = "20GBD9901";

const PLUGIN = { Name: "Claude Deck", UUID: "com.claudedeck.controls", Version: "0.1.0.0" };

/** Builds a stable UUID from a name. */
function uuid(name) {
  const h = createHash("sha1").update(`claude-deck:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const state = (extra = {}) => ({
  FontFamily: "",
  FontSize: 14,
  FontStyle: "",
  FontUnderline: false,
  OutlineThickness: 2,
  ShowTitle: false,
  TitleAlignment: "middle",
  TitleColor: "#ffffff",
  ...extra,
});

const titled = (title) => state({ ShowTitle: true, Title: title, TitleAlignment: "bottom", TitleColor: "#f1ece4" });

/** One action placed in the layout. */
function action(position, kind, name, settings = {}, title = undefined) {
  return {
    ActionID: uuid(`action:${position}:${kind}`),
    LinkedTitle: true,
    Name: name,
    Plugin: PLUGIN,
    Resources: null,
    Settings: settings,
    State: 0,
    States: [title === undefined ? {} : titled(title)],
    UUID: `com.claudedeck.controls.${kind}`,
  };
}

// Keys are placed by "column,row" on the 4 x 2 grid.
const KEYS = {
  "0,0": action("k00", "usage", "Usage", { first: "session", second: "week" }),
  "1,0": action("k10", "context", "Context", { compact: true }),
  "2,0": action("k20", "permission-mode", "Permission Mode"),
  "3,0": action("k30", "connection", "Connection"),
  "0,1": action("k01", "permission", "Permission Response", { response: "allow" }),
  "1,1": action("k11", "send-text", "Send Text", { text: "yes", submit: true }, "yes"),
  "2,1": action("k21", "send-text", "Send Text", { text: "/graphify", submit: true }, "/graphify"),
  "3,1": action("k31", "claude-status", "Claude Status"),
};

// Dials are placed by "column,0".
const DIALS = {
  "0,0": action("d0", "session-overview", "Session Overview"),
  "1,0": action("d1", "saved-prompts", "Saved Prompts", {
    prompts: ["Yes", "1", "commit", "{Clipboard}", "/graphify", "/exit"].join("\n"),
    submit: true,
  }),
  "2,0": action("d2", "usage", "Usage", { first: "session", second: "week" }),
  "3,0": action("d3", "model-picker", "Model Picker", { models: "opus\nsonnet\nhaiku" }),
};

const profileId = uuid("profile").toUpperCase();
const pageId = uuid("page");

const files = new Map();
const json = (value) => Buffer.from(JSON.stringify(value));

files.set(`${profileId}.sdProfile/manifest.json`, json({
  Device: { Model: DEVICE_MODEL, UUID: "" },
  Name: PROFILE_NAME,
  Pages: { Current: pageId, Default: pageId, Pages: [pageId] },
  Version: "3.0",
}));
files.set(`${profileId}.sdProfile/Profiles/${pageId.toUpperCase()}/manifest.json`, json({
  Controllers: [
    { Actions: KEYS, Type: "Keypad" },
    { Actions: DIALS, Type: "Encoder" },
  ],
  Icon: "",
  Name: "",
}));

/** Directories that exist in the archive, with no files in them. */
const DIRECTORIES = [`${profileId}.sdProfile/Images/`, `${profileId}.sdProfile/Profiles/${pageId.toUpperCase()}/Images/`];

/** Creates a zip archive that stores its entries without compression. */
function zip(entries) {
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const parts = [];
  const central = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const crc = data.length === 0 ? 0 : crc32(data);
    const isDirectory = name.endsWith("/");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(isDirectory ? 0x10 : 0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, centralBytes, end]);
}

const entries = [...DIRECTORIES.map((name) => [name, Buffer.alloc(0)]), ...files];
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, zip(entries));
console.log(`Wrote ${OUTPUT} (${entries.length} entries, ${Object.keys(KEYS).length} keys, ${Object.keys(DIALS).length} dials)`);
