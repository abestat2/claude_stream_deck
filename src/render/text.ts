/** Escapes the characters that are special in XML text and attribute values. */
export function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Splits text into at most `maxLines` lines of at most `maxChars` characters. Lines break between
 * words, words longer than a line are split, and the last line ends with an ellipsis when the text
 * does not fit.
 */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
	const lines: string[] = [];
	let current = "";
	let truncated = false;

	const push = (line: string): void => {
		if (lines.length < maxLines) {
			lines.push(line);
		} else {
			truncated = true;
		}
	};

	for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
		let remaining = word;
		while (remaining.length > maxChars) {
			if (current) {
				push(current);
				current = "";
			}
			push(remaining.slice(0, maxChars));
			remaining = remaining.slice(maxChars);
		}
		if (current && current.length + 1 + remaining.length > maxChars) {
			push(current);
			current = remaining;
		} else {
			current = current ? `${current} ${remaining}` : remaining;
		}
	}
	if (current) {
		push(current);
	}

	if (truncated && lines.length > 0) {
		const last = lines[lines.length - 1] ?? "";
		lines[lines.length - 1] = last.slice(0, maxChars - 1).trimEnd() + "…";
	}
	return lines;
}

/** Shortens text to at most `max` characters, ending with an ellipsis when it is cut. */
export function clipText(text: string, max: number): string {
	return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}
