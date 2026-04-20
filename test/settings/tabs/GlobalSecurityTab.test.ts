/**
 * Behavioral tests for GlobalSecurityTab (M18).
 *
 * Covers: rendering access mode, paths, and tags sections; add path/tag
 * buttons mutate config; remove handlers remove entries; Open Notes section
 * placement and toggle wiring (T3.3 spec 006).
 */

import {describe, it, expect, vi} from 'vitest';
import {renderGlobalSecurityTab} from '../../../src/settings/tabs/GlobalSecurityTab';
import type KadoPlugin from '../../../src/main';
import {renderSandbox, defaultConfig} from '../helpers';
import {App} from '../../__mocks__/obsidian';

function mockPlugin(configOverride?: Partial<ReturnType<typeof defaultConfig>>) {
	const config = {...defaultConfig(), ...configOverride};
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

describe('renderGlobalSecurityTab — rendering', () => {
	it('renders a Paths section and a Tags section', () => {
		const container = renderSandbox();
		const {plugin} = mockPlugin();

		renderGlobalSecurityTab(container, plugin, vi.fn());

		const labels = Array.from(container.querySelectorAll('.kado-section-label')).map((el) => el.textContent);
		expect(labels).toContain('Paths');
		expect(labels).toContain('Tags');
	});

	it('renders an add-path button and an add-tag button', () => {
		const container = renderSandbox();
		const {plugin} = mockPlugin();

		renderGlobalSecurityTab(container, plugin, vi.fn());

		const buttonTexts = Array.from(container.querySelectorAll('.kado-add-btn')).map((el) => el.textContent);
		expect(buttonTexts.some((t) => t?.includes('add path'))).toBe(true);
		expect(buttonTexts.some((t) => t?.includes('add tag'))).toBe(true);
	});

	it('renders one path entry per existing security.paths entry', () => {
		const container = renderSandbox();
		const {plugin} = mockPlugin({
			security: {
				listMode: 'whitelist',
				paths: [
					{
						path: 'notes/',
						permissions: {
							note: {create: true, read: true, update: true, delete: false},
							frontmatter: {create: false, read: true, update: false, delete: false},
							file: {create: false, read: false, update: false, delete: false},
							dataviewInlineField: {create: false, read: false, update: false, delete: false},
						},
					},
				],
				tags: [],
			},
		});

		renderGlobalSecurityTab(container, plugin, vi.fn());

		const pathEntries = container.querySelectorAll('.kado-path-entry');
		expect(pathEntries).toHaveLength(1);
	});
});

describe('renderGlobalSecurityTab — Open Notes section (T3.3)', () => {
	it('renders Open Notes section label between access-mode toggle and Paths label', () => {
		const container = renderSandbox();
		const {plugin} = mockPlugin();

		renderGlobalSecurityTab(container, plugin, vi.fn());

		const labels = Array.from(container.querySelectorAll('.kado-section-label')).map((el) => el.textContent);
		const openNotesIdx = labels.indexOf('Open Notes');
		const pathsIdx = labels.indexOf('Paths');

		expect(openNotesIdx).toBeGreaterThanOrEqual(0);
		expect(pathsIdx).toBeGreaterThan(openNotesIdx);
	});

	it('Open Notes section appears after the access-mode toggle in DOM order', () => {
		const container = renderSandbox();
		const {plugin} = mockPlugin();

		renderGlobalSecurityTab(container, plugin, vi.fn());

		const allChildren = Array.from(container.children);
		// Access mode toggle creates a .setting-item; Open Notes label is .kado-section-label with "Open Notes"
		const accessModeIdx = allChildren.findIndex((el) => el.classList.contains('setting-item'));
		const openNotesLabelEl = Array.from(container.querySelectorAll('.kado-section-label')).find(
			(el) => el.textContent === 'Open Notes',
		) as HTMLElement | undefined;

		expect(openNotesLabelEl).toBeDefined();
		const openNotesIdx = allChildren.indexOf(openNotesLabelEl as HTMLElement);
		expect(openNotesIdx).toBeGreaterThan(accessModeIdx);
	});

	it('toggling allowActiveNote sets security.allowActiveNote, calls saveSettings and onRedisplay', () => {
		const container = renderSandbox();
		const {plugin, config, saveSettings} = mockPlugin();
		const onRedisplay = vi.fn();

		renderGlobalSecurityTab(container, plugin, onRedisplay);

		// The mock ToggleComponent renders a div with role="switch".
		// Index 0 = access-mode toggle, index 1 = allowActiveNote, index 2 = allowOtherNotes.
		const toggles = Array.from(container.querySelectorAll('[role="switch"]'));
		const activeNoteToggle = toggles[1] as HTMLElement;

		activeNoteToggle.click();

		expect(config.security.allowActiveNote).toBe(true);
		expect(saveSettings).toHaveBeenCalled();
		expect(onRedisplay).toHaveBeenCalled();
	});

	it('toggling allowOtherNotes sets security.allowOtherNotes, calls saveSettings and onRedisplay', () => {
		const container = renderSandbox();
		const {plugin, config, saveSettings} = mockPlugin();
		const onRedisplay = vi.fn();

		renderGlobalSecurityTab(container, plugin, onRedisplay);

		// Index 0 = access-mode, 1 = allowActiveNote, 2 = allowOtherNotes
		const toggles = Array.from(container.querySelectorAll('[role="switch"]'));
		const otherNotesToggle = toggles[2] as HTMLElement;

		otherNotesToggle.click();

		expect(config.security.allowOtherNotes).toBe(true);
		expect(saveSettings).toHaveBeenCalled();
		expect(onRedisplay).toHaveBeenCalled();
	});

	it('Open Notes toggle descriptions use blacklist wording when listMode is blacklist', () => {
		const container = renderSandbox();
		const {plugin} = mockPlugin({
			security: {listMode: 'blacklist', paths: [], tags: [], allowActiveNote: false, allowOtherNotes: false},
		});

		renderGlobalSecurityTab(container, plugin, vi.fn());

		// The Setting mock places desc text in a plain div (descEl). Query all div text.
		const allText = container.textContent ?? '';
		expect(allText).toContain('Allow the currently focused note through globally');
	});

	it('Open Notes toggle descriptions use whitelist wording when listMode is whitelist', () => {
		const container = renderSandbox();
		const {plugin} = mockPlugin({
			security: {listMode: 'whitelist', paths: [], tags: [], allowActiveNote: false, allowOtherNotes: false},
		});

		renderGlobalSecurityTab(container, plugin, vi.fn());

		const allText = container.textContent ?? '';
		expect(allText).toContain('Expose the currently focused note globally');
	});
});

describe('renderGlobalSecurityTab — interactivity', () => {
	it('clicking add-path appends an entry and calls saveSettings + onRedisplay', () => {
		const container = renderSandbox();
		const {plugin, config, saveSettings} = mockPlugin();
		const onRedisplay = vi.fn();

		renderGlobalSecurityTab(container, plugin, onRedisplay);

		const addBtn = Array.from(container.querySelectorAll('.kado-add-btn'))
			.find((b) => b.textContent?.includes('add path')) as HTMLButtonElement;
		addBtn.click();

		expect(config.security.paths).toHaveLength(1);
		expect(saveSettings).toHaveBeenCalled();
		expect(onRedisplay).toHaveBeenCalled();
	});

	it('clicking add-tag appends an empty tag and calls saveSettings + onRedisplay', () => {
		const container = renderSandbox();
		const {plugin, config, saveSettings} = mockPlugin();
		const onRedisplay = vi.fn();

		renderGlobalSecurityTab(container, plugin, onRedisplay);

		const addBtn = Array.from(container.querySelectorAll('.kado-add-btn'))
			.find((b) => b.textContent?.includes('add tag')) as HTMLButtonElement;
		addBtn.click();

		expect(config.security.tags).toHaveLength(1);
		expect(saveSettings).toHaveBeenCalled();
		expect(onRedisplay).toHaveBeenCalled();
	});

	it('removing a path entry updates config and triggers redisplay', () => {
		const container = renderSandbox();
		const {plugin, config, saveSettings} = mockPlugin({
			security: {
				listMode: 'whitelist',
				paths: [
					{
						path: 'notes/',
						permissions: {
							note: {create: false, read: true, update: false, delete: false},
							frontmatter: {create: false, read: false, update: false, delete: false},
							file: {create: false, read: false, update: false, delete: false},
							dataviewInlineField: {create: false, read: false, update: false, delete: false},
						},
					},
				],
				tags: [],
			},
		});
		const onRedisplay = vi.fn();

		renderGlobalSecurityTab(container, plugin, onRedisplay);

		const removeBtn = container.querySelector('.kado-path-entry .kado-remove-btn') as HTMLButtonElement;
		removeBtn.click();

		expect(config.security.paths).toHaveLength(0);
		expect(saveSettings).toHaveBeenCalled();
		expect(onRedisplay).toHaveBeenCalled();
	});
});
