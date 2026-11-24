function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fill colour of the first text element whose serialized content equals `content`. */
export function fillOf(svg: string, content: string): string {
	return new RegExp(`fill="(#[0-9a-fA-F]{6})">${escapeRegExp(content)}</text>`).exec(svg)?.[1] ?? "";
}

/** Serialized contents of every text element, in document order. */
export function textElements(svg: string): string[] {
	return [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((match) => match[1] as string);
}

/** Decodes the SVG carried by a `data:image/svg+xml` URI. */
export function decodeDataUri(uri: string): string {
	const comma = uri.indexOf(",");
	const head = uri.slice(0, comma);
	const payload = uri.slice(comma + 1);
	return head.includes("base64") ? Buffer.from(payload, "base64").toString("utf8") : decodeURIComponent(payload);
}
