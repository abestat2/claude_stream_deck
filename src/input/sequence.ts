/**
 * Parses key sequence strings into typed text and key-press steps.
 *
 * Syntax:
 * - Plain characters are typed as text.
 * - `{Name}` presses a named key, for example `{Enter}` or `{Esc}`.
 * - `{Mod+Name}` presses a key with modifiers, for example `{Shift+Tab}` or `{Ctrl+C}`.
 * - `{{` and `}}` type a literal `{` and `}`.
 */

export type Step =
	| { type: "text"; value: string }
	| { type: "key"; vk: number; extended: boolean; modifiers: number[] };

type KeyDef = { vk: number; extended?: boolean };

const MODIFIERS: Record<string, KeyDef> = {
	ctrl: { vk: 0x11 },
	control: { vk: 0x11 },
	shift: { vk: 0x10 },
	alt: { vk: 0x12 },
	win: { vk: 0x5b, extended: true },
};

const NAMED_KEYS: Record<string, KeyDef> = {
	enter: { vk: 0x0d },
	return: { vk: 0x0d },
	esc: { vk: 0x1b },
	escape: { vk: 0x1b },
	tab: { vk: 0x09 },
	space: { vk: 0x20 },
	backspace: { vk: 0x08 },
	bksp: { vk: 0x08 },
	delete: { vk: 0x2e, extended: true },
	del: { vk: 0x2e, extended: true },
	insert: { vk: 0x2d, extended: true },
	ins: { vk: 0x2d, extended: true },
	up: { vk: 0x26, extended: true },
	down: { vk: 0x28, extended: true },
	left: { vk: 0x25, extended: true },
	right: { vk: 0x27, extended: true },
	home: { vk: 0x24, extended: true },
	end: { vk: 0x23, extended: true },
	pageup: { vk: 0x21, extended: true },
	pgup: { vk: 0x21, extended: true },
	pagedown: { vk: 0x22, extended: true },
	pgdn: { vk: 0x22, extended: true },
};

for (let i = 1; i <= 12; i++) {
	NAMED_KEYS[`f${i}`] = { vk: 0x6f + i };
}

const ENTER: Step = { type: "key", vk: 0x0d, extended: false, modifiers: [] };

/**
 * Resolves a single key name, including single letters and digits, to its virtual-key definition.
 */
function resolveKey(name: string): KeyDef | undefined {
	const lower = name.toLowerCase();
	if (NAMED_KEYS[lower]) {
		return NAMED_KEYS[lower];
	}
	if (/^[a-z0-9]$/.test(lower)) {
		return { vk: lower.toUpperCase().charCodeAt(0) };
	}
	return undefined;
}

/**
 * Parses the contents of a `{...}` token into a key step.
 * @throws Error when the token names an unknown key or modifier.
 */
function parseToken(token: string): Step {
	const parts = token.split("+").map((p) => p.trim());
	const keyName = parts.pop() ?? "";
	const key = resolveKey(keyName);
	if (!key) {
		throw new Error(`Unknown key "{${token}}"`);
	}

	const modifiers = parts.map((part) => {
		const mod = MODIFIERS[part.toLowerCase()];
		if (!mod) {
			throw new Error(`Unknown modifier "${part}" in "{${token}}"`);
		}
		return mod.vk;
	});

	return { type: "key", vk: key.vk, extended: key.extended ?? false, modifiers };
}

/**
 * Converts a key sequence string into ordered steps.
 * @param input Sequence string using the syntax described at the top of this module.
 * @param submit When true, an Enter key press is appended after the sequence.
 * @returns Steps in the order they are sent.
 * @throws Error when the sequence contains an unknown key, unknown modifier, or unclosed brace.
 */
export function parseSequence(input: string, submit: boolean): Step[] {
	const steps: Step[] = [];
	let text = "";

	const flushText = (): void => {
		if (text) {
			steps.push({ type: "text", value: text });
			text = "";
		}
	};

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];

		if (ch === "{" && input[i + 1] === "{") {
			text += "{";
			i++;
		} else if (ch === "}" && input[i + 1] === "}") {
			text += "}";
			i++;
		} else if (ch === "{") {
			const close = input.indexOf("}", i + 1);
			if (close === -1) {
				throw new Error("Unclosed \"{\" in sequence");
			}
			flushText();
			steps.push(parseToken(input.slice(i + 1, close)));
			i = close;
		} else {
			text += ch;
		}
	}

	flushText();

	if (submit && steps.length > 0) {
		steps.push(ENTER);
	}

	return steps;
}
