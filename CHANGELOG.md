# Changelog

## 0.1.0 - 2026-11-24

First release.

### Buttons

- **Claude Status**: an animated character for idle, working, waiting, and done states, with a turn timer and a wait counter. A session that keeps waiting turns the alert red.
- **Session Overview** and **Sessions**: counts of sessions, running subagents, and sessions waiting, and a dial to move through open sessions with each one's project, state, and activity.
- **Usage**: two bars for plan usage with time until reset, from the 5-hour, weekly, and Sonnet weekly windows. Shows the time until the limit when it will be reached before the window resets at the current pace, and otherwise marks the level expected at reset.
- **Context**: how full the context window is, with the model and token counts. Press to send `/compact`.
- **Permission Response**: shows the pending permission request and answers it with allow, allow always, or deny.
- **Permission Mode**: shows the permission mode and cycles it.
- **Model Picker**: choose a model and send `/model`.
- **Saved Prompts** and **Send Text**: type saved prompts and key sequences, including `{Clipboard}`.
- **Connection**: whether hook events and status line updates are arriving.

### Alerts

- A sound and a Windows notification when a session needs you, repeated while it keeps waiting, and optionally when a turn finishes.

### Setup

- Hooks and a status line command that send session data to the plugin, installed from the plugin's settings panel or with npm scripts.
- A preset layout for the Stream Deck +.
- A packaging command that builds the installable plugin file.
