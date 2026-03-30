/**
 * Behavioral tests for KadoSettingTab.
 * Tests the settings tab renders without error and shows the expected placeholder UI.
 */

import {describe, it, expect} from 'vitest';
import {App} from 'obsidian';
import KadoPlugin from '../src/main';
import {KadoSettingTab} from '../src/settings';

describe('KadoSettingTab', () => {
	const getMockTab = (): {plugin: KadoPlugin; tab: KadoSettingTab} => {
		const plugin = new KadoPlugin();
		const tab = new KadoSettingTab(new App(), plugin);
		return {plugin, tab};
	};

	describe('class contract', () => {
		it('is instantiable with an app and plugin', () => {
			const {tab} = getMockTab();
			expect(tab).toBeInstanceOf(KadoSettingTab);
		});
	});

	describe('display', () => {
		it('renders without throwing', () => {
			const {tab} = getMockTab();
			expect(() => tab.display()).not.toThrow();
		});

		it('clears the container before rendering', () => {
			const {tab} = getMockTab();
			// Pre-populate with a sentinel element.
			tab.containerEl.appendChild(document.createElement('span'));
			tab.display();
			// After display(), the sentinel should be gone (containerEl.empty() was called).
			const spans = tab.containerEl.querySelectorAll('span');
			expect(spans.length).toBe(0);
		});

		it('renders a paragraph element as the placeholder notice', () => {
			const {tab} = getMockTab();
			tab.display();
			const paragraph = tab.containerEl.querySelector('p');
			expect(paragraph).not.toBeNull();
		});

		it('renders the phase 5 placeholder notice', () => {
			const {tab} = getMockTab();
			tab.display();
			expect(tab.containerEl.textContent).toContain('phase 5');
		});
	});
});
