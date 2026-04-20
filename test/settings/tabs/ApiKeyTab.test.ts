/**
 * Behavioral tests for ApiKeyTab (M18).
 *
 * Covers: rendering for a valid key, "Key not found" when keyId is unknown,
 * rename button mutates key.label and calls saveSettings, key display shows
 * the key ID, key-management heading is present, OpenNotesSection placement
 * and toggle wiring (T3.2 spec 006).
 */

import {describe, it, expect, vi} from 'vitest';
import {renderApiKeyTab} from '../../../src/settings/tabs/ApiKeyTab';
import type KadoPlugin from '../../../src/main';
import {renderSandbox, defaultConfig, makeApiKey} from '../helpers';
import {App} from '../../__mocks__/obsidian';
import type {ApiKeyConfig} from '../../../src/types/canonical';

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
