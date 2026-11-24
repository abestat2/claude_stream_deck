# Claude Deck

A Stream Deck plugin that shows the state of Claude Code sessions and sends input to them from a Stream Deck +.

It shows which sessions are working, waiting, or finished, how much of the plan limit and context window is used, and whether a permission request is waiting. Keys and dials answer permission prompts, type saved prompts and key sequences, switch models, and cycle the permission mode.

This is an independent project. It is not made or endorsed by Anthropic or Elgato.

## Requirements

- Windows 10 or later
- Stream Deck app 7.1 or later, and a Stream Deck + (the dial actions and the preset profile are for that device; the key actions work on other Stream Deck models)
- Node.js 24 or later to build the plugin (the Stream Deck app runs the built plugin with its own Node.js)
- Claude Code

## Setup

1. Install and build:

   ```
   npm install
   npm run build
   ```

2. Link the plugin into the Stream Deck app and enable developer mode, which allows the plugin to be restarted from the command line. Restart the Stream Deck app once so it loads the plugin:

   ```
   npx streamdeck link com.claudedeck.controls.sdPlugin
   npx streamdeck dev
   ```

3. Connect Claude Code to the plugin. Either select a **Claude Status** key in the Stream Deck app and press **Install hooks and status line** in the Setup section of its settings, or run:

   ```
   npm run statusline:install
   ```

   Restart any Claude Code sessions that were already running. They read their settings when they start.

4. Optional: import the preset layout by opening `com.claudedeck.controls.sdPlugin/profiles/ClaudeDeck.streamDeckProfile`.

To undo step 3, press **Remove** in the same Setup section, or run `npm run hooks:remove`.

## Buttons

Every button appears in the **Claude Deck** category of the Stream Deck app.

| Button | Controller | What it does |
|---|---|---|
| **Claude Status** | key | An animated character: still when idle, walking with a turn timer while working, hopping when a session needs you, and a green check when a turn finished without a question. |
| **Session Overview** | dial | Counts of sessions, running subagents, and sessions waiting on you. |
| **Sessions** | dial | Turn to move through open sessions. Shows each one's project, state with timer, and the tool it is using or what it waits for. |
| **Usage** | key or dial | Two bars for plan usage with time until reset. Each bar is the 5-hour, weekly, or Sonnet weekly window. Press to refresh. |
| **Context** | key or dial | How full the context window is, with the model and token counts. Press to send `/compact`, which is refused while any session is working or waiting. |
| **Permission Response** | key | Shows the pending permission request (tool, what it wants to do, project) and answers it. Each key is set to allow (sends `1`), allow and do not ask again (sends `2`), or deny (sends `Esc`). |
| **Permission Mode** | key | Shows the current permission mode and cycles it with `Shift+Tab`. |
| **Model Picker** | dial | Turn to choose a model, press or tap to send `/model <name>`. Shows the model in use and marks the highlighted one as active. |
| **Saved Prompts** | dial | Turn to choose a saved prompt, press or tap to type it. |
| **Send Text** | key | Types a configured key sequence. |
| **Connection** | key | Whether hook events and status line updates are arriving, the session count, and whether usage can be read. |

### Settings

| Button | Setting | Default |
|---|---|---|
| Send Text | Text to send, and whether to press Enter after | Enter on |
| Saved Prompts | One prompt per line, as `text` or `label \| text`; Enter after | Enter on |
| Model Picker | Model names, one per line | `opus`, `sonnet`, `haiku` |
| Usage | Top bar and bottom bar window | 5-hour, weekly |
| Context | Send `/compact` when pressed | On |
| Permission Response | Answer (allow, always, deny); press Enter after | Allow; Enter off |

Enter is off by default on Permission Response. If a second prompt appears right after the first, an extra Enter would approve it without it being seen.

### Alerts

The settings of a Claude Status key hold alert options that apply to every Claude Status key:

| Setting | Default |
|---|---|
| Play a sound when a session needs you | On |
| Show a Windows notification | On |
| Also alert when a turn finishes | Off |
| Escalate after | 3 minutes |

A session that keeps waiting past the escalation time turns the status key red and alerts again at each interval. A session counts as needing you when it shows a permission prompt, or when its last message ends with a question (a question mark in the final paragraph).

### Key sequences

Send Text and Saved Prompts type text, and treat words in braces as keys:

| Syntax | Meaning |
|---|---|
| `{Enter}` `{Esc}` `{Tab}` `{Space}` `{Backspace}` | Named keys |
| `{Delete}` `{Insert}` `{Home}` `{End}` `{PageUp}` `{PageDown}` | Navigation keys |
| `{Up}` `{Down}` `{Left}` `{Right}` `{F1}` to `{F12}` | Arrows and function keys |
| `{Shift+Tab}` `{Ctrl+C}` `{Alt+F4}` | Keys with modifiers (`Ctrl`, `Shift`, `Alt`, `Win`) |
| `{Clipboard}` | The clipboard text. Line breaks are typed as `Ctrl+J` so the prompt is not submitted, and text over 10,000 characters is cut. |
| `{{` and `}}` | A literal `{` or `}` |

Input goes to the window that has focus. Windows does not allow input into windows running as administrator.

## Preset layout

The preset profile places the buttons on a Stream Deck +:

| | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| Keys, top | Usage | Context | Permission Mode | Connection |
| Keys, bottom | Permission Response | Send Text `yes` | Send Text `/graphify` | Claude Status |
| Dials | Session Overview | Saved Prompts | Usage | Model Picker |

The layout is defined in `scripts/build-profile.mjs`. Edit it and run `npm run profile:build` to regenerate the profile file.

## How it works

- **Hooks.** Claude Code runs an HTTP hook for 14 events (session start and end, prompts, tool use, permission requests, stops, subagents). Each posts its JSON to a receiver the plugin runs on `127.0.0.1:47831`. The receiver tracks every session and answers immediately, so hooks never delay Claude Code. If the plugin is not running, Claude Code reports the hook as failed and continues.
- **Status line.** A small command, `statusline-forward.mjs`, posts the status line input (model, context window use, plan limits) to the receiver and prints nothing.
- **Usage.** The Usage button reads the access token from the Claude Code login file, `~/.claude/.credentials.json`, and requests plan usage from an Anthropic endpoint that is not publicly documented. The token is only read. It is never refreshed, written, or logged. Automatic requests are at least a minute apart, pressing the button allows one every 10 seconds, and requests only happen while a Usage button is on screen. When the request fails, the last reading stays on screen, and plan limits from the status line fill in.
- **Input.** Keys and dials type through a PowerShell helper that calls the Windows `SendInput` API.
- **Alerts.** Sounds and notifications come from a PowerShell script. The alert text is passed in environment variables, never in the command line.

### Files changed outside this project

The Setup section and `npm run hooks:install` edit `~/.claude/settings.json`: they add the hook entries, and with the status line option the `statusLine` command. Other settings are left unchanged, an existing different status line is not replaced, and a backup is written to `settings.json.bak`. The status line command starts Node.js by an absolute path, so it does not depend on `PATH`.

The plugin's network traffic is the local receiver and, for the Usage button, the usage request described above.

## Limitations

- Windows only.
- The permission mode is reported by Claude Code only with hook events. After pressing Permission Mode, the key shows the mode that cycling should lead to, marked "predicted", and replaces it when the next event arrives. It does not notice a mode changed with the keyboard until then.
- Context, model, and plan limits come from the status line, which Claude Code runs after its first response in a session.
- The usage endpoint can change without notice.
- The mode prediction treats bypass and auto mode as enabled once a session has reported them.

## Development

| Command | Purpose |
|---|---|
| `npm run build` | Bundle `src/plugin.ts` into `com.claudedeck.controls.sdPlugin/bin/plugin.js` |
| `npm run watch` | Rebuild on changes |
| `npx streamdeck restart com.claudedeck.controls` | Reload the plugin after a build |
| `npm run typecheck` | Type-check the source and tests |
| `npm test` | Run the test suite |
| `npm run hooks:install` / `hooks:remove` | Add or remove the hooks |
| `npm run statusline:install` | Add the hooks and the status line command |
| `npm run profile:build` | Regenerate the preset profile |

Changes to `manifest.json`, such as a new button, need the Stream Deck app to be restarted.

```
src/
  actions/     one class per button
  render/      SVG drawing for keys and dials
  state/       session tracking from hook and status line events
  alerts/      alert rules, settings, and the notifier
  usage/       plan usage reading
  input/       key sequence parsing and the typing helper bridge
  server/      the local receiver
  setup/       install and remove from the settings panel
com.claudedeck.controls.sdPlugin/
  manifest.json, ui/ (settings panels), layouts/, imgs/, profiles/
  scripts/     typing helper, alert script, installer, status line forwarder
tests/         mirrors src/
```

The tests replace the keyboard, the network, the Stream Deck SDK, and the Claude settings files, so running them never types, connects, or touches real settings.
