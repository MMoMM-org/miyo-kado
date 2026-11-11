/**
 * Zod input shapes and client-facing descriptions for every Kado MCP tool.
 * Kept apart from the handlers (#135): this is the tool contract MCP clients
 * see, and it changes for different reasons than the handler logic.
 */

// NOTE: Uses Zod v4. The MCP SDK 1.29+ includes zod-compat supporting both v3 and v4.
// If tool schemas don't render correctly in clients, pin zod to "^3.22.0".
import {z} from 'zod';

export const kadoReadShape = {
	operation: z.enum(['note', 'frontmatter', 'file', 'dataview-inline-field', 'tags']).describe('What to read. Extension-strict: note/frontmatter/dataview-inline-field/tags require a .md path; file requires a non-.md path. note = full markdown body. frontmatter = YAML metadata as JSON object. dataview-inline-field = inline "key:: value" fields as JSON. tags = frontmatter + inline tags as JSON (requires note.read OR frontmatter.read; with only frontmatter.read, inline tags are omitted and returnedTags="FrontmatterOnly"). file = raw bytes returned as base64 (use for .json/.pdf/.png/…).'),
	path: z.string().describe('Vault-relative path, e.g. "Calendar/2026-03-31.md" for markdown operations or "Attachments/diagram.png" for file.'),
	mode: z.enum(['firstXChars', 'firstXWords', 'section', 'range']).optional().describe('Partial-read mode for operation="note". Absent ⇒ full read. firstXChars: return the first `limit` Unicode code points of the body. firstXWords: return the first `limit` words of the body, Unicode-aware (ICU word segmentation, so it splits space-less scripts like CJK); the response sets `truncated` when more content remains. section: return the content under a specific heading (use `heading` for first-match text, or `headingPath` for H1>H2 path). range: return a slice defined by `rangeBasis`, `start`, and `end` (line: 1-based start, inclusive end; char: 0-based start, exclusive end — ADR-4).'),
	limit: z.number().int().positive().max(1_000_000_000).optional().describe('Cap for the partial read. Required for mode=firstXChars (number of Unicode code points) and mode=firstXWords (number of words). Ignored for other modes.'),
	heading: z.string().optional().describe('Heading text to target (first match in the note). Used with mode=section. Mutually exclusive with headingPath — supply one or the other.'),
	headingPath: z.array(z.string()).max(50).optional().describe('Hierarchical heading path, e.g. ["Chapter 1", "Section A"], for precise disambiguation. Used with mode=section. Mutually exclusive with heading.'),
	rangeBasis: z.enum(['line', 'char']).optional().describe('Unit for `start` and `end`. Required for mode=range. line: start is 1-based, end is inclusive. char: start is 0-based (Unicode code points), end is exclusive. See ADR-4.'),
	start: z.number().int().nonnegative().max(1_000_000_000).optional().describe('Start of the range. For rangeBasis=line: 1-based line number (inclusive). For rangeBasis=char: 0-based code-point offset (inclusive). Required for mode=range.'),
	end: z.number().int().nonnegative().max(1_000_000_000).optional().describe('End of the range. For rangeBasis=line: line number (inclusive). For rangeBasis=char: code-point offset (exclusive). Required for mode=range.'),
};

export const kadoWriteShape = {
	operation: z.enum(['note', 'frontmatter', 'file', 'dataview-inline-field']).describe('What to write. Extension-strict: note/frontmatter/dataview-inline-field require a .md path; file requires a non-.md path (mismatches return VALIDATION_ERROR). note = full markdown body (string). frontmatter = YAML metadata (JSON object). dataview-inline-field = inline "key:: value" fields (JSON object). file = raw bytes as a base64 string, for any non-markdown file (.json/.pdf/.png/…).'),
	path: z.string().describe('Vault-relative path. Must end in ".md" for note/frontmatter/dataview-inline-field (e.g. "100 Inbox/new-note.md"); must NOT end in ".md" for file (e.g. "100 Inbox/data.json").'),
	content: z.unknown().describe('The content to write. String (markdown body) for note; JSON object for frontmatter and dataview-inline-field; base64-encoded string for file. For partial note writes (append/prepend/insertUnderHeading/replaceSection/replaceRange), this is the text to add or use as replacement.'),
	expectedModified: z.number().optional().describe('Required for updates to existing files. Set to the "modified" timestamp from a prior read. Omit only when creating a new file. Required for insertUnderHeading/replaceSection/replaceRange (ADR-5). Optional for append/prepend (lock-free operations).'),
	mode: z.enum(['merge', 'replace', 'append', 'prepend', 'insertUnderHeading', 'replaceSection', 'replaceRange']).optional().describe('Write mode. For operation="frontmatter": "merge" (default) deep-merges supplied keys with existing frontmatter (objects recurse, arrays REPLACE, scalars replace; untouched keys preserved); "replace" clears the existing block and writes the supplied object as-is; body is byte-identical in both modes. For operation="note": "append" adds content after the last line (lock-free, expectedModified optional); "prepend" inserts content before the first line (lock-free, expectedModified optional); "insertUnderHeading" appends content under the matched heading (requires expectedModified, use `heading` or `headingPath` — ADR-5); "replaceSection" replaces all content under the matched heading (requires expectedModified); "replaceRange" replaces a line or character range (requires expectedModified, `rangeBasis`, `start`, `end` — ADR-4).'),
	heading: z.string().optional().describe('Heading text to target (first match in the note). Used with mode=insertUnderHeading or mode=replaceSection. Mutually exclusive with headingPath — supply one or the other.'),
	headingPath: z.array(z.string()).max(50).optional().describe('Hierarchical heading path, e.g. ["Chapter 1", "Section A"], for precise disambiguation. Used with mode=insertUnderHeading or mode=replaceSection. Mutually exclusive with heading.'),
	rangeBasis: z.enum(['line', 'char']).optional().describe('Unit for `start` and `end`. Required for mode=replaceRange. line: start is 1-based, end is inclusive. char: start is 0-based (Unicode code points), end is exclusive. See ADR-4.'),
	start: z.number().int().nonnegative().max(1_000_000_000).optional().describe('Start of the range to replace. For rangeBasis=line: 1-based line number (inclusive). For rangeBasis=char: 0-based code-point offset (inclusive). Required for mode=replaceRange.'),
	end: z.number().int().nonnegative().max(1_000_000_000).optional().describe('End of the range to replace. For rangeBasis=line: line number (inclusive). For rangeBasis=char: code-point offset (exclusive). Required for mode=replaceRange.'),
};

export const kadoDeleteShape = {
	// Accept all 4 DataType values at the SDK boundary; mapDeleteRequest rejects
	// 'dataview-inline-field' with a canonical VALIDATION_ERROR the client can parse.
	operation: z.enum(['note', 'frontmatter', 'file', 'folder', 'dataview-inline-field']).describe('What to delete. Extension-strict: note/frontmatter require a .md path; file requires a non-.md path (mismatches return VALIDATION_ERROR). note = trash the markdown file. file = trash a non-markdown file. frontmatter = remove specific keys from a markdown file\'s YAML. folder = trash an EMPTY folder (VALIDATION_ERROR if it still contains anything; no recursive delete). dataview-inline-field is NOT supported and returns VALIDATION_ERROR.'),
	path: z.string().describe('Vault-relative path. .md for note/frontmatter, non-.md for file, the folder path for folder.'),
	expectedModified: z.number().optional().describe('The "modified" timestamp from a prior read. Required for note/file/frontmatter (CONFLICT if the file changed since); not needed for operation="folder".'),
	keys: z.array(z.string()).optional().describe('Required for operation="frontmatter": non-empty array of frontmatter keys to remove. Ignored for note/file/folder.'),
};

export const kadoRenameShape = {
	operation: z.enum(['note', 'file', 'folder']).describe('What to move. note requires .md paths; file requires non-.md paths (both source and target must share the same extension class — a rename can never change a file\'s type). folder renames a folder IN PLACE only: source and target must share the same parent (e.g. "A/old" → "A/new"), moving a folder to a different parent returns VALIDATION_ERROR.'),
	source: z.string().describe('Current vault-relative path of the file or folder to rename, e.g. "100 Inbox/draft.md" or "100 Inbox".'),
	target: z.string().describe('Desired vault-relative path, e.g. "100 Inbox/final.md" (rename) or "200 Notes/final.md" (move). For folder: same parent as source. Must not already exist — returns CONFLICT otherwise.'),
	expectedModified: z.number().optional().describe('The "modified" timestamp from a prior read of the SOURCE file. Required for note/file (CONFLICT if the source changed since); not needed for operation="folder".'),
};

export const kadoOpenNotesShape = {
	scope: z.enum(['active', 'other', 'all']).optional().describe(
		'Which open notes to enumerate: "active" (focused leaf only), "other" (non-active open notes), "all" (default, both active and other)',
	),
};

export const kadoGraphShape = {
	operation: z.enum(['backlinks', 'outgoing', 'neighbors', 'related', 'dangling']).describe('Graph navigation type'),
	path: z.string().describe('Source note path (.md). Backlinks/outgoing/neighbors/related resolve links to paths; dangling lists this note\'s unresolved link targets.'),
	limit: z.number().int().positive().optional().describe('Max nodes to return. Omit for all.'),
};

export const kadoGraphAuditShape = {
	include: z.array(z.enum(['orphans', 'deadLinks'])).nonempty().optional().describe('Which axes to compute. Omit for both.'),
	limit: z.number().int().positive().optional().describe('Max COMBINED items per page (orphans + deadLinks). Omit to return everything in one page.'),
	cursor: z.string().optional().describe('Opaque pagination cursor from a previous response. Pass it back to fetch the next page.'),
};

export const KADO_GRAPH_AUDIT_TOOL_DESCRIPTION =
	'Vault-wide link-graph audit in a single call — the whole-vault counterpart to kado-graph. Returns ' +
	'orphans (notes with no resolved links in OR out — fully disconnected) and ' +
	'deadLinks (every unresolved/broken wikilink across the vault: { source, target, count }, where target is the raw unresolved link text, not a path). ' +
	'Returns { operation: "audit-graph", orphans: [{ path }], deadLinks: [{ source, target, count }], total: { orphans, deadLinks }, cursor, truncated }. ' +
	'Use "include" to compute just one axis. Results are paginated by "limit"/"cursor" (orphans first, then deadLinks); omit "limit" for everything in one page. ' +
	'Scoped to this key: orphans are filtered by their own path, dead links by their source path; "total" reflects post-ACL counts. ' +
	'Answered from Obsidian\'s in-memory link index (no per-note disk reads), which can briefly lag the disk after external bulk changes.';

export const KADO_GRAPH_TOOL_DESCRIPTION =
	'Navigate the Obsidian link graph from a source note (.md). Operations: ' +
	'backlinks (notes that link TO the source), ' +
	'outgoing (resolved targets the source links to), ' +
	'neighbors (1-hop union of backlinks + outgoing), ' +
	'related (2-hop notes reached via a neighbour; each result carries "via" — the neighbour(s) it was reached through), ' +
	'dangling (the source\'s unresolved/broken link targets, with reference "count"). ' +
	'Returns { source, operation, nodes: [{ path, relation, via?, count? }] }. ' +
	'Requires note read permission on the source; resolved result nodes outside this key\'s scope are silently omitted. ' +
	'Reads Obsidian\'s in-memory link index, which can briefly lag the disk after external bulk changes.';

export const kadoSearchShape = {
	operation: z.enum(['byTag', 'byName', 'listDir', 'listTags', 'byContent', 'byFrontmatter', 'listNotes']).describe('Search operation type'),
	query: z.string().optional().describe('Search query. Required for all operations except listDir, listTags, and listNotes. Supports * and ? glob wildcards for byName and byTag.'),
	path: z.string().optional().describe('Folder walk root for listDir and listNotes. "/" is the canonical vault-root marker; trailing slashes are accepted; non-existent paths return NOT_FOUND; paths pointing to a file return VALIDATION_ERROR; empty string is rejected.'),
	cursor: z.string().optional().describe('Pagination cursor from a previous response'),
	limit: z.number().int().min(1).max(500).optional().describe('Max items per page (default 50, max 500)'),
	depth: z.number().int().positive().optional().describe('Walk depth for listDir and listNotes. Omit for unlimited recursion. depth=1 returns only direct children. Invalid values (0, negative, non-integer) return VALIDATION_ERROR.'),
	fields: z.array(z.enum(['links', 'headings', 'tags'])).optional().describe('listNotes projection — body-derived metadata to include per note, sourced from the metadata cache (no body read): links (outlinks, raw [[target]] and ![[embed]] strings as written — may point outside this key\'s scope, they are source-note content and are never resolved), headings ({heading, level} outline), tags (inline + frontmatter, deduped). Omit for none (path + timestamps only). Ignored by other operations.'),
	filter: z.object({
		path: z.string().optional().describe('Folder prefix filter — only items whose path starts with this value. Works with all operations.'),
		tags: z.array(z.string()).optional().describe('Tag filter — item must carry at least one matching tag. Supports * and ? glob wildcards. Ignored by listDir.'),
		frontmatter: z.string().optional().describe('Frontmatter filter — key=value (match value) or key-only (key exists). Dot-notation traverses nested keys (e.g. "tomo.state=pending-approval"). Same syntax as byFrontmatter query. Ignored by listDir.'),
		modifiedAfter: z.number().int().nonnegative().optional().describe('Inclusive lower bound on file mtime (Unix milliseconds). Drops folder items. Combine with modifiedBefore for a range; use Date.now() - 7*86400000 for "last 7 days".'),
		modifiedBefore: z.number().int().nonnegative().optional().describe('Inclusive upper bound on file mtime (Unix milliseconds). Drops folder items.'),
		createdAfter: z.number().int().nonnegative().optional().describe('Inclusive lower bound on file ctime (Unix milliseconds). Drops folder items.'),
		createdBefore: z.number().int().nonnegative().optional().describe('Inclusive upper bound on file ctime (Unix milliseconds). Drops folder items.'),
	}).optional().describe('Universal cross-operation filters to narrow results. All filters are AND-combined.'),
};

export const KADO_SEARCH_TOOL_DESCRIPTION =
	'Search the Obsidian vault. Operations: ' +
	'byName (substring or glob e.g. "2026-03-*"), ' +
	'byTag (exact or glob e.g. "#project/*"), ' +
	'byContent (full-text body search — matches notes containing any query term, ranked by relevance; each result carries a "score" and "snippets" {text, line} of the matching passages, sorted best-first), ' +
	'byFrontmatter (key=value or key-only; dot-notation traverses nested keys e.g. "tomo.state=pending-approval"), ' +
	'listDir (folder contents with type: "file" | "folder" discriminator; folder items carry childCount; results sort folders-first then alphabetically; use depth=1 for a shallow scan of direct children only, omit depth for unlimited recursion; "/" is the canonical vault-root marker; missing paths return NOT_FOUND, file targets return VALIDATION_ERROR), ' +
	'listTags (all permitted tags with counts), ' +
	'listNotes (notes-only metadata index — like listDir but markdown notes only, no folders; path + depth select the subtree, filter narrows within it; optional "fields" projection adds outlinks, headings, and tags from the metadata cache without reading note bodies). ' +
	'Optional "filter" narrows any operation: filter.path (folder prefix), filter.tags (note must have at least one matching tag, glob-capable), filter.frontmatter (key=value or key-only; dot-notation traverses nested keys), filter.modifiedAfter / filter.modifiedBefore / filter.createdAfter / filter.createdBefore (Unix-ms time bounds, inclusive; folder items are dropped when any time bound is set). Filters are AND-combined. filter.tags and filter.frontmatter are ignored by listDir; time filters apply to listDir file items. ' +
	'Results are scoped to this key\'s permissions and paginated (default 50, max 500). ' +
	'Hidden entries (names starting with ".") are never returned.';

export const KADO_READ_TOOL_DESCRIPTION =
	'Read from the Obsidian vault. Strict extension separation: operation "note" / "frontmatter" / "dataview-inline-field" / "tags" only accept .md paths; operation "file" is for any non-markdown file (.json, .pdf, .png, …) and returns base64. Returns content + created/modified/size metadata. Use the "modified" timestamp from the response as expectedModified when writing updates. Op-symmetry rule: pair the read op with the matching write op to minimise payload — read=frontmatter before write=frontmatter (body-free both directions), read=note only when you actually need the body. For listing/filtering by mtime or frontmatter without loading content at all, use kado-search instead (results carry path/created/modified/size/tags/frontmatter without reading files). operation="tags" returns {frontmatter: string[], inline: string[], all: string[], returnedTags: "All" | "FrontmatterOnly"} — tags deduplicated, no leading "#". When the key has only frontmatter.read (no note.read), inline tags are omitted and returnedTags="FrontmatterOnly" signals that additional inline tags may exist but require note.read.';

export const KADO_WRITE_TOOL_DESCRIPTION =
	'Write to the Obsidian vault. Strict extension separation — pick the operation that matches the target path: operation="note" writes a full markdown body (path MUST end in .md); operation="frontmatter" writes a YAML frontmatter object onto a markdown file (.md only); operation="dataview-inline-field" writes Dataview inline "key:: value" fields onto a markdown file (.md only); operation="file" writes raw bytes via base64 for any NON-markdown file (.json, .pdf, .png, …) and REJECTS .md paths. Mismatched combinations (e.g. operation="note" with a .json path, or operation="file" with a .md path) return VALIDATION_ERROR — switch to the correct operation rather than renaming the file. To CREATE a new file: omit expectedModified. To UPDATE an existing file: first read it with kado-read and pass the "modified" value as expectedModified. Op-symmetry rule: use the matching read op for the body-cheapest path — kado-read operation=frontmatter before write operation=frontmatter (metadata-only both directions, no body transfer), kado-read operation=note only when the write needs the full body. Returns CONFLICT if the file changed since your read. For operation="frontmatter" the body is never touched — only the YAML block changes; use mode="merge" (default) to deep-merge supplied keys with existing frontmatter (objects recurse, arrays REPLACE, scalars replace, untouched keys preserved) or mode="replace" to clear the existing block and write the supplied object as-is.';

export const KADO_DELETE_TOOL_DESCRIPTION =
	'Delete from the Obsidian vault. operation=note|file moves the file to the user\'s configured trash (respects Obsidian settings). operation=frontmatter removes specific keys via the "keys" array. Always requires expectedModified — read the file first and pass the "modified" timestamp. Returns CONFLICT if the file changed since your read, NOT_FOUND if missing.';

export const KADO_RENAME_TOOL_DESCRIPTION =
	'Rename or move a file in the Obsidian vault (operation=note for .md, operation=file for non-.md). Inbound links (`[[wikilinks]]` and markdown links) are updated automatically when Obsidian\'s "Automatically update internal links" is on. Rename = same folder, different name; move = different folder. Permissions: a rename needs note/file UPDATE on the path; a move needs DELETE on the source folder AND CREATE on the target folder. Always requires expectedModified — read the source first and pass its "modified" timestamp. Returns CONFLICT if the source changed or the target already exists, NOT_FOUND if the source is missing, VALIDATION_ERROR on bad/mismatched paths. If "Automatically update internal links" is OFF, Obsidian shows a per-rename confirmation dialog: the file is still moved immediately, but the response may include "linkUpdatePending": true meaning inbound links await the user\'s answer — do NOT retry in that case (the rename already happened). A bare TIMEOUT (no move) is only returned if the file did not move at all.';

export const KADO_OPEN_NOTES_TOOL_DESCRIPTION =
	'List currently open Obsidian notes. Gated by per-key feature flags (allowActiveNote, allowOtherNotes) and path ACL. Read-only — does not modify workspace state. Returns { notes: [{ name, path, active, type }] }. Returns FORBIDDEN with gate="feature-gate" when the requested scope is disabled by either the global or key flag; returns an empty list when no permitted files are open or all are silently filtered by the path ACL.';
