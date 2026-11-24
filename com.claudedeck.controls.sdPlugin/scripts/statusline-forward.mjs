// Forwards the JSON that Claude Code passes to a status line command to the local plugin receiver.
//
// Reads standard input, POSTs it to http://127.0.0.1:<port>/statusline, and prints nothing.
// The port is 47831 unless the CLAUDE_DECK_PORT environment variable is set.
// Failures are ignored so the status line never shows an error or delays Claude Code.

import { request } from "node:http";

const port = Number(process.env.CLAUDE_DECK_PORT) || 47831;
const chunks = [];

// Exit even if the receiver never answers.
setTimeout(() => process.exit(0), 1500).unref();

process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("error", () => process.exit(0));
process.stdin.on("end", () => {
  const body = Buffer.concat(chunks);
  if (body.length === 0) {
    return;
  }

  const req = request(
    {
      host: "127.0.0.1",
      port,
      path: "/statusline",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": body.length },
      timeout: 1000,
    },
    (res) => res.resume(),
  );
  req.on("error", () => {});
  req.on("timeout", () => req.destroy());
  req.end(body);
});
