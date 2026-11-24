/**
 * Returns the permission mode that Shift+Tab switches to from the given mode.
 *
 * The order is default, accept edits, plan, then bypass permissions or auto when those modes are
 * enabled, and back to default. Whether bypass or auto is enabled is not reported directly, so a mode
 * counts as enabled once a session has reported it.
 * @param mode The current permission mode.
 * @param seen Permission modes that sessions have reported so far.
 */
export function nextMode(mode: string, seen: ReadonlySet<string>): string {
	switch (mode) {
		case "default":
			return "acceptEdits";
		case "acceptEdits":
			return "plan";
		case "plan":
			return seen.has("bypassPermissions") ? "bypassPermissions" : seen.has("auto") ? "auto" : "default";
		case "bypassPermissions":
			return seen.has("auto") ? "auto" : "default";
		default:
			return "default";
	}
}
