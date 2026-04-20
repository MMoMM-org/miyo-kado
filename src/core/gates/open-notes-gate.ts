/**
 * Feature-gate for the open-notes tool.
 *
 * Evaluates whether an OpenNotesScope request is permitted based on the AND
 * of global SecurityConfig and ApiKeyConfig flags. No inheritance — both
 * layers must have the flag enabled for the category to be accessible.
 */

import type {SecurityConfig, ApiKeyConfig, CoreError} from '../../types/canonical';
import type {OpenNotesScope} from '../../types/canonical';

export type FeatureGateOutcome =
	| {kind: 'allow-active-only'}
	| {kind: 'allow-other-only'}
	| {kind: 'allow-both'}
	| {kind: 'deny'; error: CoreError};

function buildOffMessage(scope: 'active' | 'other', global: SecurityConfig, key: ApiKeyConfig): string {
	const flag = scope === 'active' ? 'allowActiveNote' : 'allowOtherNotes';
	const globalOn = scope === 'active' ? global.allowActiveNote : global.allowOtherNotes;
	const keyOn = scope === 'active' ? key.allowActiveNote : key.allowOtherNotes;

	if (!globalOn && !keyOn) return `global ${flag} is off; key ${flag} is off`;
	if (!globalOn) return `global ${flag} is off`;
	return `key ${flag} is off`;
}

function forbidden(scope: OpenNotesScope, global: SecurityConfig, key: ApiKeyConfig): CoreError {
	const message = scope === 'all'
		? buildAllDenyMessage(global, key)
		: buildOffMessage(scope, global, key);
	return {code: 'FORBIDDEN', message, gate: 'feature-gate'};
}

function buildAllDenyMessage(global: SecurityConfig, key: ApiKeyConfig): string {
	const parts: string[] = [];
	if (!global.allowActiveNote || !key.allowActiveNote) {
		parts.push(buildOffMessage('active', global, key));
	}
	if (!global.allowOtherNotes || !key.allowOtherNotes) {
		parts.push(buildOffMessage('other', global, key));
	}
	return parts.join('; ');
}

/**
 * Determines which note categories are accessible for the given scope.
 *
 * Both global and key flags must be true for a category to be active (AND,
 * no inheritance). For scope='all', categories with off flags are silently
 * filtered rather than causing denial — only denies when both categories are
 * gated.
 */
export function gateOpenNoteScope(
	scope: OpenNotesScope,
	global: SecurityConfig,
	key: ApiKeyConfig,
): FeatureGateOutcome {
	const activeOn = global.allowActiveNote && key.allowActiveNote;
	const otherOn = global.allowOtherNotes && key.allowOtherNotes;

	if (scope === 'active') {
		if (activeOn) return {kind: 'allow-active-only'};
		return {kind: 'deny', error: forbidden('active', global, key)};
	}

	if (scope === 'other') {
		if (otherOn) return {kind: 'allow-other-only'};
		return {kind: 'deny', error: forbidden('other', global, key)};
	}

	// scope === 'all': silently filter off categories; deny only when both are off
	if (activeOn && otherOn) return {kind: 'allow-both'};
	if (activeOn) return {kind: 'allow-active-only'};
	if (otherOn) return {kind: 'allow-other-only'};
	return {kind: 'deny', error: forbidden('all', global, key)};
}
