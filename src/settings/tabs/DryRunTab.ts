/**
 * DryRunTab — the "Permission Test" settings panel (#83).
 *
 * Lets the user pick a key + operation + data type + path (+ optional tag) and
 * see, live, whether that request would be ALLOWED or DENIED, which gate decided
 * and why — running the real permission chain via runDryRun (no duplicated
 * logic, read-only, never touches the vault).
 *
 * Form state lives on the KadoSettingsTab instance (passed in as `state`) so it
 * survives re-renders and, crucially, switching the selected key without losing
 * the entered path/tag/operation. Recomputation writes into a static result
 * container — never a full settings redisplay — so text inputs keep focus.
 */

import {Setting} from 'obsidian';
import type KadoPlugin from '../../main';
import {createDefaultGateChain} from '../../core/permission-chain';
import {runDryRun} from '../../core/dry-run';
import type {DryRunInput, DryRunOperation} from '../../core/dry-run';
import type {ReadDataType} from '../../types/canonical';
import {PathInputSuggest} from '../components/PathInputSuggest';
import {TagInputSuggest} from '../components/TagInputSuggest';

/** Persisted form state for the dry-run panel (held on the settings tab instance). */
export interface DryRunState {
	keyId?: string;
	operation: DryRunOperation;
	dataType: ReadDataType;
	path: string;
	target: string;
	tag: string;
}

/** Fresh default dry-run form state. */
export function createDryRunState(): DryRunState {
	return {operation: 'read', dataType: 'note', path: '', target: '', tag: ''};
}

const OPERATIONS: {value: DryRunOperation; label: string}[] = [
	{value: 'read', label: 'Read'},
	{value: 'create', label: 'Create'},
	{value: 'update', label: 'Update'},
	{value: 'delete', label: 'Delete'},
	{value: 'rename', label: 'Rename / move'},
	{value: 'search', label: 'Search'},
];

/** Data-type options valid for each operation (search uses none). */
function dataTypesFor(operation: DryRunOperation): {value: ReadDataType; label: string}[] {
	const all: {value: ReadDataType; label: string}[] = [
		{value: 'note', label: 'Note'},
		{value: 'frontmatter', label: 'Frontmatter'},
		{value: 'file', label: 'File (binary)'},
		{value: 'dataview-inline-field', label: 'Dataview inline field'},
		{value: 'tags', label: 'Tags'},
	];
	switch (operation) {
		case 'read': return all;
		case 'create':
		case 'update': return all.filter((d) => d.value !== 'tags');
		case 'delete': return all.filter((d) => d.value === 'note' || d.value === 'frontmatter' || d.value === 'file');
		case 'rename': return all.filter((d) => d.value === 'note' || d.value === 'file');
		case 'search': return [];
	}
}

export function renderDryRunTab(containerEl: HTMLElement, plugin: KadoPlugin, state: DryRunState): void {
	containerEl.empty();
	const config = plugin.configManager.getConfig();

	new Setting(containerEl).setName('Permission test').setHeading();
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'Simulate a request against the real permission chain — no vault access, nothing is written. '
			+ 'See whether a key would be allowed, which gate decides, and why.',
	});

	if (config.apiKeys.length === 0) {
		containerEl.createEl('p', {cls: 'setting-item-description', text: 'Create an API key first to test its permissions.'});
		return;
	}

	// Default the selected key to the first one if unset or stale.
	if (!state.keyId || !config.apiKeys.some((k) => k.id === state.keyId)) {
		state.keyId = config.apiKeys[0]!.id;
	}

	// Re-render the whole tab (state persists externally) — used for structural
	// changes (operation switch alters datatype options + visible fields).
	const rerender = (): void => renderDryRunTab(containerEl, plugin, state);

	// ── Key ──
	new Setting(containerEl)
		.setName('API key')
		.setDesc('Switching keys keeps the path, tag and operation below.')
		.addDropdown((drop) => {
			for (const key of config.apiKeys) {
				drop.addOption(key.id, `${key.label}${key.enabled ? '' : ' (disabled)'}`);
			}
			drop.setValue(state.keyId!);
			drop.onChange((value) => {
				state.keyId = value;
				recompute();
			});
		});

	// ── Operation ──
	new Setting(containerEl)
		.setName('Operation')
		.addDropdown((drop) => {
			for (const op of OPERATIONS) drop.addOption(op.value, op.label);
			drop.setValue(state.operation);
			drop.onChange((value) => {
				state.operation = value as DryRunOperation;
				// Keep dataType valid for the new operation.
				const valid = dataTypesFor(state.operation).map((d) => d.value);
				if (valid.length > 0 && !valid.includes(state.dataType)) {
					state.dataType = valid[0]!;
				}
				rerender();
			});
		});

	// ── Data type (hidden for search) ──
	const dataTypes = dataTypesFor(state.operation);
	if (dataTypes.length > 0) {
		new Setting(containerEl)
			.setName('Data type')
			.addDropdown((drop) => {
				for (const d of dataTypes) drop.addOption(d.value, d.label);
				drop.setValue(state.dataType);
				drop.onChange((value) => {
					state.dataType = value as ReadDataType;
					recompute();
				});
			});
	}

	// ── Path (source for rename; hidden for search) ──
	if (state.operation !== 'search') {
		const pathSetting = new Setting(containerEl)
			.setName(state.operation === 'rename' ? 'Source path' : 'Path')
			.addText((text) => {
				text.setPlaceholder('Folder/Note.md').setValue(state.path);
				text.onChange((value) => {
					state.path = value;
					recompute();
				});
				new PathInputSuggest(plugin.app, text.inputEl, (value) => {
					state.path = value;
					recompute();
				});
			});
		pathSetting.descEl.setText('Type to fuzzy-search files and folders.');
	}

	// ── Target path (rename only) ──
	if (state.operation === 'rename') {
		new Setting(containerEl)
			.setName('Target path')
			.setDesc('Same folder ⇒ rename (needs update); different folder ⇒ move (needs delete on source + create on target).')
			.addText((text) => {
				text.setPlaceholder('Folder/New name.md').setValue(state.target);
				text.onChange((value) => {
					state.target = value;
					recompute();
				});
				new PathInputSuggest(plugin.app, text.inputEl, (value) => {
					state.target = value;
					recompute();
				});
			});
	}

	// ── Tag (optional, independent readout) ──
	new Setting(containerEl)
		.setName('Tag (optional)')
		.setDesc('Independent check: is this tag within the key\'s tag scope? Tags do not gate path access yet.')
		.addText((text) => {
			text.setPlaceholder('Project').setValue(state.tag);
			text.onChange((value) => {
				state.tag = value;
				recompute();
			});
			new TagInputSuggest(plugin.app, text.inputEl, (value) => {
				state.tag = value;
				recompute();
			});
		});

	// ── Result ──
	const resultEl = containerEl.createDiv({cls: 'kado-dryrun-result'});
	const recompute = (): void => renderResult(resultEl, plugin, state);
	recompute();
}

/** Renders the verdict + tag-scope readout into the (static) result container. */
function renderResult(resultEl: HTMLElement, plugin: KadoPlugin, state: DryRunState): void {
	resultEl.empty();
	const config = plugin.configManager.getConfig();

	// Path-based operations need a path before a meaningful verdict.
	if (state.operation !== 'search' && state.path.trim() === '') {
		resultEl.createEl('p', {cls: 'setting-item-description', text: 'Enter a path to see the result.'});
		if (state.tag.trim() !== '') renderTagScope(resultEl, plugin, state);
		return;
	}
	if (state.operation === 'rename' && state.target.trim() === '') {
		resultEl.createEl('p', {cls: 'setting-item-description', text: 'Enter a target path to see the result.'});
		if (state.tag.trim() !== '') renderTagScope(resultEl, plugin, state);
		return;
	}

	const input: DryRunInput = {
		keyId: state.keyId!,
		operation: state.operation,
		dataType: state.dataType,
		path: state.path.trim(),
		target: state.target.trim() || undefined,
		tag: state.tag.trim() || undefined,
	};
	const result = runDryRun(input, config, createDefaultGateChain());

	const verdict = resultEl.createDiv({cls: `kado-dryrun-verdict ${result.allowed ? 'is-allowed' : 'is-denied'}`});
	verdict.createSpan({cls: 'kado-dryrun-badge', text: result.allowed ? 'ALLOWED' : 'DENIED'});
	if (result.mode) verdict.createSpan({cls: 'kado-dryrun-mode', text: result.mode === 'move' ? 'move' : 'rename'});

	if (!result.allowed && result.gate) {
		resultEl.createEl('p', {cls: 'kado-dryrun-gate', text: `Deciding gate: ${result.gate}`});
	}
	resultEl.createEl('p', {cls: 'kado-dryrun-reason', text: result.reason});

	if (state.tag.trim() !== '') renderTagScope(resultEl, plugin, state, result.tagScope);
}

/** Renders the secondary tag-scope line. */
function renderTagScope(
	resultEl: HTMLElement,
	plugin: KadoPlugin,
	state: DryRunState,
	precomputed?: 'in-scope' | 'out-of-scope' | 'not-checked',
): void {
	const scope = precomputed ?? runDryRun(
		{keyId: state.keyId!, operation: state.operation, dataType: state.dataType, path: state.path.trim(), tag: state.tag.trim()},
		plugin.configManager.getConfig(), createDefaultGateChain(),
	).tagScope;
	if (scope === 'not-checked') return;
	const inScope = scope === 'in-scope';
	const line = resultEl.createEl('p', {cls: `kado-dryrun-tagscope ${inScope ? 'is-in' : 'is-out'}`});
	line.setText(`Tag #${state.tag.trim().replace(/^#/, '')}: ${inScope ? 'in scope' : 'out of scope'} for this key`);
}
