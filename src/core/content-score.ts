/**
 * Proximity-based content scoring and snippet extraction for kado-search
 * byContent. Turns "does the body contain the query" into "how relevant is
 * this note, and where" — ranking by query-term coverage and how tightly the
 * terms cluster, plus sentence-bounded excerpts.
 *
 * Pure: no imports from `obsidian` or `@modelcontextprotocol/sdk`.
 *
 * Lexical only (no embeddings). The cluster/coverage/proximity shape is adapted
 * from the proximity-index approach in obsidian-mcp-plugin, but the weighting
 * deviates deliberately: raw term-density is dropped and proximity is gated by
 * coverage, so a lone isolated term cannot out-rank a note that actually covers
 * more of the query.
 */

import type {ContentSnippet} from '../types/canonical';

/** Max character gap between consecutive matches that still belong to one cluster. */
const MAX_CLUSTER_GAP = 50;
/** Upper bound on snippets returned per note. */
const MAX_SNIPPETS = 5;
/** Hard cap on a snippet's character length. */
const SNIPPET_MAX_LEN = 300;
/** How far (each side) snippet expansion may walk looking for a sentence boundary. */
const SNIPPET_SIDE_BUDGET = SNIPPET_MAX_LEN / 2;
/** Coverage dominates; proximity is a secondary, coverage-scaled bonus. */
const COVERAGE_WEIGHT = 0.7;
const PROXIMITY_WEIGHT = 0.3;

/** Result of scoring one note body against a query. */
export interface ContentScore {
	/** 0 when no query term occurs; otherwise the best cluster's score. */
	score: number;
	snippets: ContentSnippet[];
}

interface Match {
	pos: number;
	term: string;
}

interface Cluster {
	start: number;
	end: number;
	terms: Set<string>;
}

/** Lowercase word tokens of the query, de-duplicated, order preserved. */
function tokenize(query: string): string[] {
	const tokens = query.toLowerCase().match(/\w+/g);
	if (!tokens) return [];
	return Array.from(new Set(tokens));
}

/** All occurrence positions of every term in `haystack` (already lowercased), sorted by position. */
function findMatches(haystack: string, terms: string[]): Match[] {
	const matches: Match[] = [];
	for (const term of terms) {
		let from = 0;
		for (;;) {
			const idx = haystack.indexOf(term, from);
			if (idx === -1) break;
			matches.push({pos: idx, term});
			from = idx + term.length;
		}
	}
	matches.sort((a, b) => a.pos - b.pos);
	return matches;
}

/** Groups sorted matches into clusters; a gap larger than MAX_CLUSTER_GAP starts a new cluster. */
function clusterMatches(matches: Match[]): Cluster[] {
	const clusters: Cluster[] = [];
	let current: Cluster | null = null;
	for (const {pos, term} of matches) {
		if (current === null || pos - current.end > MAX_CLUSTER_GAP) {
			current = {start: pos, end: pos, terms: new Set([term])};
			clusters.push(current);
		} else {
			current.end = pos;
			current.terms.add(term);
		}
	}
	return clusters;
}

/**
 * Score a cluster: coverage (share of distinct query terms present) dominates,
 * proximity (tightness of the cluster span) adds a coverage-scaled bonus so it
 * cannot inflate a single-term match above a broader one.
 */
function scoreCluster(cluster: Cluster, totalTerms: number): number {
	const span = cluster.end - cluster.start + 1;
	const coverage = cluster.terms.size / totalTerms;
	const proximity = 1 / (1 + Math.log(span));
	return coverage * COVERAGE_WEIGHT + coverage * proximity * PROXIMITY_WEIGHT;
}

/** True when `ch` ends a sentence/line — used as a snippet boundary. */
function isBoundary(ch: string): boolean {
	return ch === '.' || ch === '!' || ch === '?' || ch === '\n';
}

/** Extracts a sentence-bounded, length-capped snippet from the ORIGINAL-case content. */
function extractSnippet(content: string, cluster: Cluster): ContentSnippet {
	let start = cluster.start;
	while (start > 0 && cluster.start - start < SNIPPET_SIDE_BUDGET && !isBoundary(content[start - 1]!)) {
		start--;
	}
	let end = cluster.end;
	while (end < content.length && end - cluster.end < SNIPPET_SIDE_BUDGET && !isBoundary(content[end]!)) {
		end++;
	}
	let text = content.slice(start, end).trim();
	if (text.length > SNIPPET_MAX_LEN) text = text.slice(0, SNIPPET_MAX_LEN).trim();
	const newlinesBefore = content.slice(0, cluster.start).match(/\n/g)?.length ?? 0;
	return {text, line: newlinesBefore + 1};
}

/**
 * Scores `content` against `query`. Returns score 0 (and no snippets) when the
 * query has no word tokens or none occur. Snippets come from the highest-scoring
 * clusters, capped at MAX_SNIPPETS.
 */
export function scoreContent(content: string, query: string): ContentScore {
	const terms = tokenize(query);
	if (terms.length === 0) return {score: 0, snippets: []};

	const matches = findMatches(content.toLowerCase(), terms);
	if (matches.length === 0) return {score: 0, snippets: []};

	const clusters = clusterMatches(matches);
	const ranked = clusters
		.map((cluster) => ({cluster, clusterScore: scoreCluster(cluster, terms.length)}))
		.sort((a, b) => b.clusterScore - a.clusterScore);

	const score = ranked[0]!.clusterScore;
	const snippets = ranked
		.slice(0, MAX_SNIPPETS)
		.map(({cluster}) => extractSnippet(content, cluster));

	return {score, snippets};
}
