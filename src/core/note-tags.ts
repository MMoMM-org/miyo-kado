/**
 * Note tag extraction from raw markdown — pure core helpers.
 *
 * Exists so every place that needs "which tags does this note carry" (the
 * `tags` read operation, the tag access policy #81, create-time checks on new
 * content) shares one definition of frontmatter splitting and tag
 * normalization. The YAML parser is injected so this module stays free of
 * `obsidian` imports; the Obsidian layer passes `parseYaml`.
 *
 * ZERO imports from `obsidian` or `@modelcontextprotocol/sdk`.
 */

import {extractInlineTags, normalizeTag} from './tag-utils';

/** Parses a YAML document into a plain value. Obsidian's `parseYaml` satisfies this. */
export type YamlParser = (yaml: string) => unknown;

/**
 * Splits content at the YAML frontmatter boundary into `{prefix, body}` where
 * `prefix + body === content` in the normal case. The split point is returned
 * explicitly rather than reconstructed by length arithmetic, so callers (e.g.
 * prepend) can never run the closing fence and inserted text together.
 *
 * Edge case: a frontmatter-only file whose closing `---` is the very last byte
 * (no trailing newline). There is no body, and concatenating onto the bare
 * fence would corrupt it, so the prefix is normalized with a trailing newline.
 */
export function splitFrontmatter(content: string): {prefix: string; body: string} {
	if (!content.startsWith('---')) return {prefix: '', body: content};
	const end = content.indexOf('\n---', 3);
	if (end === -1) return {prefix: '', body: content};
	const afterFence = content.indexOf('\n', end + 1);
	if (afterFence === -1) return {prefix: content + '\n', body: ''};
	return {prefix: content.slice(0, afterFence + 1), body: content.slice(afterFence + 1)};
}

/**
 * Returns the raw YAML text inside a frontmatter block (between the opening and
 * closing `---` fences), or null if `prefix` is not a frontmatter block. Operates
 * on the `prefix` returned by splitFrontmatter, which is `---\n<yaml>\n---\n`.
 */
export function innerYaml(prefix: string): string | null {
	if (!prefix.startsWith('---')) return null;
	const open = prefix.indexOf('\n');
	const close = prefix.indexOf('\n---', open);
	if (open === -1 || close === -1) return null;
	return prefix.slice(open + 1, close + 1);
}

/** Returns `tags` with duplicates removed, keeping the first occurrence of each. */
export function dedupePreservingOrder(tags: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const tag of tags) {
		if (!seen.has(tag)) {
			seen.add(tag);
			out.push(tag);
		}
	}
	return out;
}

/**
 * Normalizes a frontmatter `tags` value: accepts the string form (split at
 * whitespace or commas) or an array of strings; strips `#`, drops empties and
 * non-strings, dedupes. Any other shape yields [].
 */
export function normalizeFrontmatterTags(raw: unknown): string[] {
	const collected: string[] = [];
	if (typeof raw === 'string') {
		for (const token of raw.split(/[\s,]+/)) {
			const tag = normalizeTag(token);
			if (tag !== null) collected.push(tag);
		}
	} else if (Array.isArray(raw)) {
		for (const entry of raw) {
			if (typeof entry !== 'string') continue;
			const tag = normalizeTag(entry);
			if (tag !== null) collected.push(tag);
		}
	}
	return dedupePreservingOrder(collected);
}

/**
 * Extracts every tag a note carries from its raw markdown: frontmatter `tags`
 * plus inline `#tags` in the body (code blocks/spans excluded). Unparseable
 * frontmatter contributes no tags; inline tags are still read. Tags are
 * returned without `#`, deduped, frontmatter first.
 */
export function extractNoteTags(content: string, parseYaml: YamlParser): string[] {
	const {prefix, body} = splitFrontmatter(content);
	const frontmatter = readFrontmatterTagsFromYaml(innerYaml(prefix), parseYaml);
	return dedupePreservingOrder([...frontmatter, ...extractInlineTags(body)]);
}

function readFrontmatterTagsFromYaml(yaml: string | null, parseYaml: YamlParser): string[] {
	if (yaml === null) return [];
	let parsed: unknown;
	try {
		parsed = parseYaml(yaml);
	} catch {
		return [];
	}
	if (parsed === null || typeof parsed !== 'object') return [];
	return normalizeFrontmatterTags((parsed as Record<string, unknown>)['tags']);
}
