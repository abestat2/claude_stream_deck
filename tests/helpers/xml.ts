/**
 * Minimal XML well-formedness check for generated SVG: balanced tags, quoted attributes,
 * a single root element, and no bare `<` or `&` in text or attribute values.
 * Returns an empty string when the document is well formed, otherwise a description of the problem.
 */
export function xmlProblem(xml: string): string {
	const stack: string[] = [];
	let roots = 0;
	let i = 0;

	const checkText = (value: string): string => {
		if (value.includes("<")) return "bare < in text";
		if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(value)) return `bare & in "${value}"`;
		if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return "control character";
		return "";
	};

	while (i < xml.length) {
		if (xml[i] !== "<") {
			const end = xml.indexOf("<", i);
			const chunk = xml.slice(i, end === -1 ? xml.length : end);
			if (stack.length === 0 && chunk.trim() !== "") return "text outside root";
			const problem = checkText(chunk);
			if (problem) return problem;
			i = end === -1 ? xml.length : end;
			continue;
		}

		const close = xml.indexOf(">", i);
		if (close === -1) return "unterminated tag";
		const tag = xml.slice(i + 1, close);

		if (tag.startsWith("/")) {
			const name = tag.slice(1).trim();
			if (stack.pop() !== name) return `mismatched closing tag </${name}>`;
		} else {
			const selfClosing = tag.endsWith("/");
			const body = selfClosing ? tag.slice(0, -1) : tag;
			const match = /^([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*$/.exec(body);
			if (!match) return `malformed tag <${tag}>`;
			const problem = checkText(match[2] ?? "");
			if (problem) return problem;
			if (stack.length === 0) roots++;
			if (!selfClosing) stack.push(match[1] as string);
		}
		i = close + 1;
	}

	if (stack.length > 0) return `unclosed <${stack[stack.length - 1]}>`;
	return roots === 1 ? "" : `expected one root element, found ${roots}`;
}

/** Concatenated text content of an SVG string with tags removed. */
export function textContent(xml: string): string {
	return xml.replace(/<[^>]*>/g, "");
}
