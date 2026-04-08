/**
 * Behavioral tests for GlobalSecurityTab (M18).
 *
 * Covers: rendering access mode, paths, and tags sections; add path/tag
 * buttons mutate config; remove handlers remove entries.
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
