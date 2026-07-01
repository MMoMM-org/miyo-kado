/**
 * Behavioral tests for runDryRun — the pure core behind the settings
 * "Permission Test" panel (issue #83).
 *
 * runDryRun answers "would key K be allowed to do OP on PATH?" by composing the
 * SAME permission chain the MCP tools use (evaluatePermissions +
 * evaluateRenamePermissions), so the dry-run can never drift from real behavior.
 * It also reports an independent, secondary tag-scope readout: whether an
 * optional tag falls within the key's effective (global ∩ key) tag scope.
 */

import {describe, it, expect} from 'vitest';
import {runDryRun} from '../../src/core/dry-run';
import {createDefaultGateChain} from '../../src/core/permission-chain';
import {createAllPermissions} from '../../src/core/gates/scope-resolver';
import {createDefaultConfig, createDefaultApiKeyConfig} from '../../src/types/canonical';
import type {DataTypePermissions, KadoConfig, PermissionGate} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const KEY_ID = 'kado_test-key';

/** Config with one enabled key whose global+key scope both grant `perms` on `path`. */
function configWith(
	path: string,
	perms: DataTypePermissions,
	opts: {globalTags?: string[]; keyTags?: string[]} = {},
): KadoConfig {
	const config = createDefaultConfig();
	config.security.paths = [{path, permissions: perms}];
	config.security.tags = opts.globalTags ?? [];
	config.apiKeys = [
		createDefaultApiKeyConfig({
			id: KEY_ID,
			label: 'test',
			enabled: true,
			listMode: 'whitelist',
			paths: [{path, permissions: perms}],
			tags: opts.keyTags ?? [],
		}),
	];
	return config;
}

/** DataTypePermissions with only the given note flags set. */
function notePerms(flags: Partial<DataTypePermissions['note']>): DataTypePermissions {
	const p = createAllPermissions();
	// reset to nothing, then apply requested note flags
	p.note = {create: false, read: false, update: false, delete: false, ...flags};
	p.frontmatter = {create: false, read: false, update: false, delete: false};
	p.file = {create: false, read: false, update: false, delete: false};
	p.dataviewInlineField = {create: false, read: false, update: false, delete: false};
	return p;
}

const gates = (): PermissionGate[] => createDefaultGateChain();

// ---------------------------------------------------------------------------
// Path verdict — read / create / update / delete
// ---------------------------------------------------------------------------

describe('runDryRun — read', () => {
	it('ALLOWS a note read when the key has note.read on the path', () => {
		const config = configWith('Atlas', notePerms({read: true}));
		const res = runDryRun({keyId: KEY_ID, operation: 'read', dataType: 'note', path: 'Atlas/n.md'}, config, gates());
		expect(res.allowed).toBe(true);
		expect(res.reason).toBeTruthy();
	});

	it('DENIES a note read at datatype-permission when note.read is absent', () => {
		const config = configWith('Atlas', notePerms({read: false, update: true}));
		const res = runDryRun({keyId: KEY_ID, operation: 'read', dataType: 'note', path: 'Atlas/n.md'}, config, gates());
		expect(res.allowed).toBe(false);
		expect(res.gate).toBe('datatype-permission');
		expect(res.code).toBe('FORBIDDEN');
		expect(res.reason).toContain("'read'");
	});

	it('DENIES at global-scope when the path is outside scope', () => {
		const config = configWith('Atlas', notePerms({read: true}));
		const res = runDryRun({keyId: KEY_ID, operation: 'read', dataType: 'note', path: 'Journal/secret.md'}, config, gates());
		expect(res.allowed).toBe(false);
		expect(res.gate).toBe('global-scope');
	});
});

describe('runDryRun — create vs update (CRUD inference)', () => {
	it('ALLOWS create when the key has note.create', () => {
		const config = configWith('Atlas', notePerms({create: true}));
		const res = runDryRun({keyId: KEY_ID, operation: 'create', dataType: 'note', path: 'Atlas/new.md'}, config, gates());
		expect(res.allowed).toBe(true);
	});

	it('DENIES create when the key only has update (create != update)', () => {
		const config = configWith('Atlas', notePerms({update: true, create: false}));
		const res = runDryRun({keyId: KEY_ID, operation: 'create', dataType: 'note', path: 'Atlas/new.md'}, config, gates());
		expect(res.allowed).toBe(false);
		expect(res.gate).toBe('datatype-permission');
		expect(res.reason).toContain("'create'");
	});

	it('ALLOWS update when the key has note.update', () => {
		const config = configWith('Atlas', notePerms({update: true}));
		const res = runDryRun({keyId: KEY_ID, operation: 'update', dataType: 'note', path: 'Atlas/n.md'}, config, gates());
		expect(res.allowed).toBe(true);
	});

	it('DENIES update when the key only has create', () => {
		const config = configWith('Atlas', notePerms({create: true, update: false}));
		const res = runDryRun({keyId: KEY_ID, operation: 'update', dataType: 'note', path: 'Atlas/n.md'}, config, gates());
		expect(res.allowed).toBe(false);
		expect(res.reason).toContain("'update'");
	});
});

describe('runDryRun — delete', () => {
	it('ALLOWS delete when the key has note.delete', () => {
		const config = configWith('Atlas', notePerms({delete: true}));
		const res = runDryRun({keyId: KEY_ID, operation: 'delete', dataType: 'note', path: 'Atlas/n.md'}, config, gates());
		expect(res.allowed).toBe(true);
	});

	it('DENIES delete when note.delete is absent', () => {
		const config = configWith('Atlas', notePerms({read: true, delete: false}));
		const res = runDryRun({keyId: KEY_ID, operation: 'delete', dataType: 'note', path: 'Atlas/n.md'}, config, gates());
		expect(res.allowed).toBe(false);
		expect(res.reason).toContain("'delete'");
	});
});

// ---------------------------------------------------------------------------
// Path verdict — rename (in-folder) vs move (cross-folder)
// ---------------------------------------------------------------------------

describe('runDryRun — rename / move', () => {
	it('reports mode="rename" and ALLOWS an in-folder rename with note.update', () => {
		const config = configWith('Atlas', notePerms({update: true}));
		const res = runDryRun(
			{keyId: KEY_ID, operation: 'rename', dataType: 'note', path: 'Atlas/a.md', target: 'Atlas/b.md'},
			config, gates());
		expect(res.mode).toBe('rename');
		expect(res.allowed).toBe(true);
	});

	it('reports mode="move" and DENIES a cross-folder move without create on target', () => {
		// Grant delete on the whole vault via blacklist-free whitelist on 'Atlas' only.
		const config = configWith('Atlas', notePerms({update: true, delete: true, create: true}));
		// Target folder 'Other' is outside scope → move needs create on target → denied.
		const res = runDryRun(
			{keyId: KEY_ID, operation: 'rename', dataType: 'note', path: 'Atlas/a.md', target: 'Other/a.md'},
			config, gates());
		expect(res.mode).toBe('move');
		expect(res.allowed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Path verdict — search capability
// ---------------------------------------------------------------------------

describe('runDryRun — search', () => {
	it('ALLOWS search when the key has note.read somewhere in scope', () => {
		const config = configWith('Atlas', notePerms({read: true}));
		const res = runDryRun({keyId: KEY_ID, operation: 'search', dataType: 'note', path: ''}, config, gates());
		expect(res.allowed).toBe(true);
	});

	it('DENIES search when the key has no note.read anywhere', () => {
		const config = configWith('Atlas', notePerms({update: true, read: false}));
		const res = runDryRun({keyId: KEY_ID, operation: 'search', dataType: 'note', path: ''}, config, gates());
		expect(res.allowed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe('runDryRun — authentication', () => {
	it('DENIES at authenticate for an unknown key', () => {
		const config = configWith('Atlas', notePerms({read: true}));
		const res = runDryRun({keyId: 'kado_nope', operation: 'read', dataType: 'note', path: 'Atlas/n.md'}, config, gates());
		expect(res.allowed).toBe(false);
		expect(res.gate).toBe('authenticate');
		expect(res.code).toBe('UNAUTHORIZED');
	});

	it('DENIES at authenticate for a disabled key', () => {
		const config = configWith('Atlas', notePerms({read: true}));
		config.apiKeys[0]!.enabled = false;
		const res = runDryRun({keyId: KEY_ID, operation: 'read', dataType: 'note', path: 'Atlas/n.md'}, config, gates());
		expect(res.allowed).toBe(false);
		expect(res.code).toBe('UNAUTHORIZED');
	});
});

// ---------------------------------------------------------------------------
// Secondary tag-scope readout (independent of the path verdict)
// ---------------------------------------------------------------------------

describe('runDryRun — tag-scope readout', () => {
	it('reports "not-checked" when no tag is supplied', () => {
		const config = configWith('Atlas', notePerms({read: true}));
		const res = runDryRun({keyId: KEY_ID, operation: 'read', dataType: 'note', path: 'Atlas/n.md'}, config, gates());
		expect(res.tagScope).toBe('not-checked');
	});

	it('reports "in-scope" when the tag is in both global and key tag scope', () => {
		const config = configWith('Atlas', notePerms({read: true}), {globalTags: ['project'], keyTags: ['project']});
		const res = runDryRun(
			{keyId: KEY_ID, operation: 'read', dataType: 'note', path: 'Atlas/n.md', tag: 'project'}, config, gates());
		expect(res.tagScope).toBe('in-scope');
	});

	it('reports "out-of-scope" when the tag is not in the key tag scope', () => {
		const config = configWith('Atlas', notePerms({read: true}), {globalTags: ['project'], keyTags: ['project']});
		const res = runDryRun(
			{keyId: KEY_ID, operation: 'read', dataType: 'note', path: 'Atlas/n.md', tag: 'private'}, config, gates());
		expect(res.tagScope).toBe('out-of-scope');
	});

	it('reports "out-of-scope" when the key has no tags at all', () => {
		const config = configWith('Atlas', notePerms({read: true}), {globalTags: ['project'], keyTags: []});
		const res = runDryRun(
			{keyId: KEY_ID, operation: 'read', dataType: 'note', path: 'Atlas/n.md', tag: 'project'}, config, gates());
		expect(res.tagScope).toBe('out-of-scope');
	});

	it('normalizes a leading # on the queried tag', () => {
		const config = configWith('Atlas', notePerms({read: true}), {globalTags: ['project'], keyTags: ['project']});
		const res = runDryRun(
			{keyId: KEY_ID, operation: 'read', dataType: 'note', path: 'Atlas/n.md', tag: '#project'}, config, gates());
		expect(res.tagScope).toBe('in-scope');
	});
});
