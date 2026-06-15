/**
 * Behavioral tests for ApiKeyTab (M18).
 *
 * Covers: rendering for a valid key, "Key not found" when keyId is unknown,
 * rename button mutates key.label and calls saveSettings, key display shows
 * the key ID, key-management heading is present, OpenNotesSection placement
 * and toggle wiring (T3.2 spec 006).
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {renderApiKeyTab} from '../../../src/settings/tabs/ApiKeyTab';
import type KadoPlugin from '../../../src/main';
import {renderSandbox, defaultConfig, makeApiKey, click} from '../helpers';
import {App} from '../../__mocks__/obsidian';
import {createDefaultPermissions} from '../../../src/types/canonical';
import type {ApiKeyConfig, DataTypePermissions, PathPermission} from '../../../src/types/canonical';

// Capture VaultFolderModal construction so the narrow flow can be driven without
// a real Obsidian modal. vi.hoisted gives the factory a shared instance list.
const {vfmInstances} = vi.hoisted(() => ({
	vfmInstances: [] as Array<{
		onSelect: (path: string) => void;
		restrictToPrefixes: string[] | undefined;
		opened: boolean;
	}>,
}));

vi.mock('../../../src/settings/components/VaultFolderModal', () => ({
	VaultFolderModal: class {
		onSelect: (path: string) => void;
		restrictToPrefixes: string[] | undefined;
		opened = false;
		constructor(_app: unknown, onSelect: (path: string) => void, restrictToPrefixes?: string[]) {
			this.onSelect = onSelect;
			this.restrictToPrefixes = restrictToPrefixes;
			vfmInstances.push(this);
		}
		open(): void {
			this.opened = true;
		}
	},
}));

beforeEach(() => {
	vfmInstances.length = 0;
});

function mockPlugin(keys: ApiKeyConfig[] = [makeApiKey()]) {
	const config = {...defaultConfig(), apiKeys: keys};
	const saveSettings = vi.fn(async () => undefined);
	const app = new App();

	const plugin = {
		app,
		settings: config,
		configManager: {getConfig: () => config},
		saveSettings,
	} as unknown as KadoPlugin;

	return {plugin, config, saveSettings};
}

function readOnlyPermissions(): DataTypePermissions {
	return {
		note: {create: false, read: true, update: false, delete: false},
		frontmatter: {create: false, read: true, update: false, delete: false},
		file: {create: false, read: true, update: false, delete: false},
		dataviewInlineField: {create: false, read: true, update: false, delete: false},
	};
}

/** Builds a plugin whose global security has the given paths plus the given keys. */
function mockPluginWithSecurity(securityPaths: PathPermission[], keys: ApiKeyConfig[]) {
	const base = defaultConfig();
	const config = {...base, apiKeys: keys, security: {...base.security, paths: securityPaths}};
	const saveSettings = vi.fn(async () => undefined);
	const plugin = {
		app: new App(),
		settings: config,
		configManager: {getConfig: () => config},
		saveSettings,
	} as unknown as KadoPlugin;
	return {plugin, config, saveSettings};
}

/** Finds the inline "+ add path" button (distinct from "+ add tag"). */
function clickAddPath(container: HTMLElement): void {
	const addBtn = Array.from(container.querySelectorAll('button.kado-add-btn'))
		.find((b) => b.textContent === '+ add path');
	if (!addBtn) throw new Error('add-path button not found');
	click(addBtn);
}

describe('renderApiKeyTab — missing key', () => {
	it('renders a "Key not found" message when keyId does not match any key', () => {
		const container = renderSandbox();
		const {plugin} = mockPlugin([makeApiKey({id: 'kado_other'})]);

		renderApiKeyTab(container, plugin, 'kado_missing', vi.fn(), vi.fn());

		expect(container.textContent).toContain('not found');
	});
});

describe('renderApiKeyTab — rendering', () => {
	it('renders the Key management heading', () => {
		const container = renderSandbox();
		const key = makeApiKey({id: 'kado_a'});
		const {plugin} = mockPlugin([key]);

		renderApiKeyTab(container, plugin, key.id, vi.fn(), vi.fn());

		const headings = Array.from(container.querySelectorAll('.setting-heading'))
			.map((el) => el.getAttribute('data-setting-name'));
		expect(headings).toContain('Key management');
	});

	it('displays the API key id in the key display span', () => {
		const container = renderSandbox();
		const key = makeApiKey({id: 'kado_test-display'});
		const {plugin} = mockPlugin([key]);

		renderApiKeyTab(container, plugin, key.id, vi.fn(), vi.fn());

		const keyDisplay = container.querySelector('.kado-key-display');
		expect(keyDisplay?.textContent).toBe('kado_test-display');
	});

	it('pre-fills the rename input with the current key label', () => {
		const container = renderSandbox();
		const key = makeApiKey({id: 'kado_a', label: 'Original Label'});
		const {plugin} = mockPlugin([key]);

		renderApiKeyTab(container, plugin, key.id, vi.fn(), vi.fn());

		const nameSetting = container.querySelector('[data-setting-name="Key name"]') as HTMLElement;
		const input = nameSetting.querySelector('input[type="text"]') as HTMLInputElement;
		expect(input.value).toBe('Original Label');
	});
});

describe('renderApiKeyTab — rename flow', () => {
	it('clicking Rename updates key.label and calls saveSettings', async () => {
		const container = renderSandbox();
		const key = makeApiKey({id: 'kado_a', label: 'Old'});
		const {plugin, saveSettings} = mockPlugin([key]);
		const onRedisplay = vi.fn();

		renderApiKeyTab(container, plugin, key.id, onRedisplay, vi.fn());

		const nameSetting = container.querySelector('[data-setting-name="Key name"]') as HTMLElement;
		const input = nameSetting.querySelector('input[type="text"]') as HTMLInputElement;
		input.value = 'New Name';

		// Rename is the second button in the Key name setting (first is the input-adjacent one)
		const renameBtn = Array.from(nameSetting.querySelectorAll('button'))
			.find((b) => b.textContent === 'Rename') as HTMLButtonElement;
		renameBtn.click();

		// Wait for the async onClick handler
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(key.label).toBe('New Name');
		expect(saveSettings).toHaveBeenCalled();
		expect(onRedisplay).toHaveBeenCalled();
	});
});

describe('renderApiKeyTab — OpenNotesSection placement', () => {
	it('renders the Open Notes section label between Access Mode setting and Paths label', () => {
		const container = renderSandbox();
		const key = makeApiKey({id: 'kado_a', allowActiveNote: false, allowOtherNotes: false});
		const {plugin} = mockPlugin([key]);

		renderApiKeyTab(container, plugin, key.id, vi.fn(), vi.fn());

		const allChildren = Array.from(container.querySelectorAll('[data-setting-name="Access mode"], .kado-section-label'));
		const labels = allChildren.map(el => el.getAttribute('data-setting-name') ?? el.textContent ?? '');

		const accessModeIdx = labels.indexOf('Access mode');
		const openNotesIdx = labels.indexOf('Open Notes');
		const pathsIdx = labels.indexOf('Paths');

		expect(accessModeIdx).toBeGreaterThanOrEqual(0);
		expect(openNotesIdx).toBeGreaterThanOrEqual(0);
		expect(pathsIdx).toBeGreaterThanOrEqual(0);
		expect(openNotesIdx).toBeGreaterThan(accessModeIdx);
		expect(pathsIdx).toBeGreaterThan(openNotesIdx);
	});

	it('renders Active note and Other open notes settings', () => {
		const container = renderSandbox();
		const key = makeApiKey({id: 'kado_a', allowActiveNote: true, allowOtherNotes: false});
		const {plugin} = mockPlugin([key]);

		renderApiKeyTab(container, plugin, key.id, vi.fn(), vi.fn());

		const settingNames = Array.from(container.querySelectorAll('[data-setting-name]'))
			.map(el => el.getAttribute('data-setting-name'));
		expect(settingNames).toContain('Active note');
		expect(settingNames).toContain('Other open notes');
	});
});

describe('renderApiKeyTab — OpenNotesSection toggle wiring', () => {
	it('toggling Active note sets key.allowActiveNote, calls saveSettings and onRedisplay', () => {
		const container = renderSandbox();
		const key = makeApiKey({id: 'kado_a', allowActiveNote: false, allowOtherNotes: false});
		const {plugin, saveSettings} = mockPlugin([key]);
		const onRedisplay = vi.fn();

		renderApiKeyTab(container, plugin, key.id, onRedisplay, vi.fn());

		const activeNoteSetting = container.querySelector('[data-setting-name="Active note"]') as HTMLElement;
		const toggle = activeNoteSetting.querySelector('[role="switch"]') as HTMLElement;
		toggle.click();

		expect(key.allowActiveNote).toBe(true);
		expect(saveSettings).toHaveBeenCalled();
		expect(onRedisplay).toHaveBeenCalled();
	});

	it('toggling Other open notes sets key.allowOtherNotes, calls saveSettings and onRedisplay', () => {
		const container = renderSandbox();
		const key = makeApiKey({id: 'kado_a', allowActiveNote: false, allowOtherNotes: false});
		const {plugin, saveSettings} = mockPlugin([key]);
		const onRedisplay = vi.fn();

		renderApiKeyTab(container, plugin, key.id, onRedisplay, vi.fn());

		const otherNotesSetting = container.querySelector('[data-setting-name="Other open notes"]') as HTMLElement;
		const toggle = otherNotesSetting.querySelector('[role="switch"]') as HTMLElement;
		toggle.click();

		expect(key.allowOtherNotes).toBe(true);
		expect(saveSettings).toHaveBeenCalled();
		expect(onRedisplay).toHaveBeenCalled();
	});

	it('toggling Active note from true to false sets key.allowActiveNote to false', () => {
		const container = renderSandbox();
		const key = makeApiKey({id: 'kado_a', allowActiveNote: true, allowOtherNotes: false});
		const {plugin, saveSettings} = mockPlugin([key]);
		const onRedisplay = vi.fn();

		renderApiKeyTab(container, plugin, key.id, onRedisplay, vi.fn());

		const activeNoteSetting = container.querySelector('[data-setting-name="Active note"]') as HTMLElement;
		const toggle = activeNoteSetting.querySelector('[role="switch"]') as HTMLElement;
		// Toggle is initialized to true (aria-checked="true"), clicking flips it to false
		toggle.click();

		expect(key.allowActiveNote).toBe(false);
		expect(saveSettings).toHaveBeenCalled();
		expect(onRedisplay).toHaveBeenCalled();
	});
});

describe('renderApiKeyTab — path narrowing to subfolders (#74)', () => {
	it('opens one folder browser scoped to all global path prefixes', () => {
		const container = renderSandbox();
		const key = makeApiKey({id: 'kado_n', paths: []});
		const {plugin} = mockPluginWithSecurity(
			[
				{path: 'Atlas/**', permissions: createDefaultPermissions()},
				{path: 'Projects', permissions: createDefaultPermissions()},
			],
			[key],
		);

		renderApiKeyTab(container, plugin, key.id, vi.fn(), vi.fn());
		clickAddPath(container);

		expect(vfmInstances).toHaveLength(1);
		// 'Atlas/**' → prefix 'Atlas'; 'Projects' → 'Projects'.
		expect(vfmInstances[0]?.restrictToPrefixes).toEqual(['Atlas', 'Projects']);
		expect(vfmInstances[0]?.opened).toBe(true);
	});

	it('shows a Notice and opens no browser when no global paths are defined', () => {
		const container = renderSandbox();
		const key = makeApiKey({id: 'kado_empty', paths: []});
		const {plugin} = mockPluginWithSecurity([], [key]);

		renderApiKeyTab(container, plugin, key.id, vi.fn(), vi.fn());
		clickAddPath(container);

		expect(vfmInstances).toHaveLength(0);
	});

	it('bounds a narrowed key path matrix by its ancestor global path permissions', () => {
		const container = renderSandbox();
		// Global allows Atlas read-only; key is narrowed to a subfolder under it.
		const key = makeApiKey({
			id: 'kado_c',
			paths: [{path: 'Atlas/202 Notes', permissions: createDefaultPermissions()}],
		});
		const {plugin} = mockPluginWithSecurity(
			[{path: 'Atlas', permissions: readOnlyPermissions()}],
			[key],
		);

		renderApiKeyTab(container, plugin, key.id, vi.fn(), vi.fn());

		// Read-only ceiling → create/update/delete dots disabled (12), read enabled (4).
		const disabled = container.querySelectorAll('.kado-path-entry .kado-dot[aria-disabled="true"]');
		expect(disabled).toHaveLength(12);
	});

	it('adds the folder chosen in the browser as the key path', () => {
		const container = renderSandbox();
		const key = makeApiKey({id: 'kado_f', paths: []});
		const {plugin, saveSettings} = mockPluginWithSecurity(
			[{path: 'Atlas/**', permissions: createDefaultPermissions()}],
			[key],
		);
		const onRedisplay = vi.fn();

		renderApiKeyTab(container, plugin, key.id, onRedisplay, vi.fn());
		clickAddPath(container);

		expect(vfmInstances).toHaveLength(1);
		expect(vfmInstances[0]?.restrictToPrefixes).toEqual(['Atlas']);

		// Simulate the user picking a subfolder in the browser.
		vfmInstances[0]?.onSelect('Atlas/202 Notes');

		expect(key.paths.map(p => p.path)).toContain('Atlas/202 Notes');
		expect(saveSettings).toHaveBeenCalled();
		expect(onRedisplay).toHaveBeenCalled();
	});

	it('refuses to add a duplicate path', () => {
		const container = renderSandbox();
		const key = makeApiKey({
			id: 'kado_d',
			paths: [{path: 'Atlas/202 Notes', permissions: createDefaultPermissions()}],
		});
		const {plugin} = mockPluginWithSecurity(
			[{path: 'Atlas', permissions: createDefaultPermissions()}],
			[key],
		);

		renderApiKeyTab(container, plugin, key.id, vi.fn(), vi.fn());
		clickAddPath(container);
		vfmInstances[0]?.onSelect('Atlas/202 Notes');

		expect(key.paths.filter(p => p.path === 'Atlas/202 Notes')).toHaveLength(1);
	});
});
