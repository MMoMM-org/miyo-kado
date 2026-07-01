/**
 * Behavioral tests for ImportConfigModal (#84).
 *
 * The modal renders a toggle per importable section (general, global security,
 * and each key) and, on confirm, reports the selected sections. Deselecting a
 * key must exclude it; cancel must not confirm.
 */

import {describe, it, expect, vi} from 'vitest';
import {ImportConfigModal} from '../../../src/settings/components/ImportConfigModal';
import {App} from '../../__mocks__/obsidian';
import type {ImportSummary} from '../../../src/core/config-portability';

function summary(): ImportSummary {
	return {
		version: 1,
		exportedAt: 1_700_000_000_000,
		general: true,
		security: {listMode: 'whitelist', paths: 2, tags: 1},
		keys: [
			{id: 'kado_aaa', label: 'Assistant A', enabled: true},
			{id: 'kado_bbb', label: 'Assistant B', enabled: false},
		],
	};
}

function clickButton(root: HTMLElement, text: string): void {
	const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement;
	btn.click();
}

function toggleOff(root: HTMLElement, settingName: string): void {
	const setting = root.querySelector(`[data-setting-name="${settingName}"]`) as HTMLElement;
	(setting.querySelector('[role="switch"]') as HTMLElement).click();
}

describe('ImportConfigModal', () => {
	it('renders a toggle per section and per key', () => {
		const modal = new ImportConfigModal(new App() as never, {summary: summary(), onConfirm: vi.fn()});
		modal.open();
		const names = Array.from(modal.contentEl.querySelectorAll('[data-setting-name]'))
			.map((e) => e.getAttribute('data-setting-name'));
		expect(names).toContain('General settings');
		expect(names).toContain('Global security');
		expect(names).toContain('Assistant A');
		expect(names).toContain('Assistant B');
	});

	it('confirms with all sections selected by default', () => {
		const onConfirm = vi.fn();
		const modal = new ImportConfigModal(new App() as never, {summary: summary(), onConfirm});
		modal.open();
		clickButton(modal.contentEl, 'Import selected');
		expect(onConfirm).toHaveBeenCalledWith({general: true, security: true, keyIds: ['kado_aaa', 'kado_bbb']});
	});

	it('excludes a deselected key', () => {
		const onConfirm = vi.fn();
		const modal = new ImportConfigModal(new App() as never, {summary: summary(), onConfirm});
		modal.open();
		toggleOff(modal.contentEl, 'Assistant B');
		clickButton(modal.contentEl, 'Import selected');
		expect(onConfirm).toHaveBeenCalledWith({general: true, security: true, keyIds: ['kado_aaa']});
	});

	it('excludes general and security when deselected', () => {
		const onConfirm = vi.fn();
		const modal = new ImportConfigModal(new App() as never, {summary: summary(), onConfirm});
		modal.open();
		toggleOff(modal.contentEl, 'General settings');
		toggleOff(modal.contentEl, 'Global security');
		clickButton(modal.contentEl, 'Import selected');
		expect(onConfirm).toHaveBeenCalledWith({general: false, security: false, keyIds: ['kado_aaa', 'kado_bbb']});
	});

	it('does not confirm when cancelled', () => {
		const onConfirm = vi.fn();
		const modal = new ImportConfigModal(new App() as never, {summary: summary(), onConfirm});
		modal.open();
		clickButton(modal.contentEl, 'Cancel');
		expect(onConfirm).not.toHaveBeenCalled();
	});
});
