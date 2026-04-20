/**
 * Behavioral tests for OpenNotesSection (T3.1, spec 006).
 *
 * Covers: section label, two toggle rendering, wording per listMode+scope,
 * callback invocation with new boolean value.
 */

import {describe, it, expect, vi} from 'vitest';
import {renderOpenNotesSection} from '../../../src/settings/components/OpenNotesSection';
import {renderSandbox, click} from '../helpers';

interface OpenNotesSectionState {
	allowActiveNote: boolean;
	allowOtherNotes: boolean;
}

function makeState(overrides?: Partial<OpenNotesSectionState>): OpenNotesSectionState {
	return {allowActiveNote: false, allowOtherNotes: false, ...overrides};
}

function makeCallbacks() {
	return {
		onToggleActive: vi.fn(),
		onToggleOther: vi.fn(),
	};
}

/** Returns the descEl text for a Setting identified by its data-setting-name. */
function getSettingDesc(container: HTMLElement, name: string): string {
	// settingEl has [data-setting-name]; descEl is the second div child (after nameEl)
	const settingEl = container.querySelector(`[data-setting-name="${name}"]`);
	const divChildren = Array.from(settingEl?.children ?? []).filter((el) => el.tagName === 'DIV');
	// divChildren[0] = nameEl, divChildren[1] = descEl
	return divChildren[1]?.textContent ?? '';
}

/** Returns the toggle element (role="switch") for a Setting. */
function getToggle(container: HTMLElement, name: string): HTMLElement | null {
	return container.querySelector(`[data-setting-name="${name}"] [role="switch"]`) as HTMLElement | null;
}

describe('renderOpenNotesSection — section label', () => {
	it('renders a kado-section-label div with text "Open Notes"', () => {
		const container = renderSandbox();
		renderOpenNotesSection(container, makeState(), 'whitelist', 'key', makeCallbacks());

		const label = container.querySelector('.kado-section-label');
		expect(label).not.toBeNull();
		expect(label?.textContent).toBe('Open Notes');
	});
});

describe('renderOpenNotesSection — toggle rendering', () => {
	it('renders exactly two Setting instances with names "Active note" and "Other open notes"', () => {
		const container = renderSandbox();
		renderOpenNotesSection(container, makeState(), 'whitelist', 'key', makeCallbacks());

		const settings = container.querySelectorAll('[data-setting-name]');
		const names = Array.from(settings).map((el) => el.getAttribute('data-setting-name'));
		expect(names).toContain('Active note');
		expect(names).toContain('Other open notes');
		expect(settings).toHaveLength(2);
	});
});

describe('renderOpenNotesSection — wording: whitelist + key scope', () => {
	it('active-note toggle shows "Expose…to this key" for whitelist key scope', () => {
		const container = renderSandbox();
		renderOpenNotesSection(container, makeState(), 'whitelist', 'key', makeCallbacks());

		const desc = getSettingDesc(container, 'Active note');
		expect(desc).toBe('Expose the currently focused note to this key');
	});

	it('other-notes toggle shows "Expose…to this key" for whitelist key scope', () => {
		const container = renderSandbox();
		renderOpenNotesSection(container, makeState(), 'whitelist', 'key', makeCallbacks());

		const desc = getSettingDesc(container, 'Other open notes');
		expect(desc).toBe('Expose non-active open notes to this key');
	});
});

describe('renderOpenNotesSection — wording: blacklist + key scope', () => {
	it('active-note toggle shows "Allow…through to this key" for blacklist key scope', () => {
		const container = renderSandbox();
		renderOpenNotesSection(container, makeState(), 'blacklist', 'key', makeCallbacks());

		const desc = getSettingDesc(container, 'Active note');
		expect(desc).toBe('Allow the currently focused note through to this key');
	});

	it('other-notes toggle shows "Allow…through to this key" for blacklist key scope', () => {
		const container = renderSandbox();
		renderOpenNotesSection(container, makeState(), 'blacklist', 'key', makeCallbacks());

		const desc = getSettingDesc(container, 'Other open notes');
		expect(desc).toBe('Allow non-active open notes through to this key');
	});
});

describe('renderOpenNotesSection — wording: whitelist + global scope', () => {
	it('active-note toggle shows "Expose…globally" for whitelist global scope', () => {
		const container = renderSandbox();
		renderOpenNotesSection(container, makeState(), 'whitelist', 'global', makeCallbacks());

		const desc = getSettingDesc(container, 'Active note');
		expect(desc).toBe('Expose the currently focused note globally');
	});

	it('other-notes toggle shows "Expose…globally" for whitelist global scope', () => {
		const container = renderSandbox();
		renderOpenNotesSection(container, makeState(), 'whitelist', 'global', makeCallbacks());

		const desc = getSettingDesc(container, 'Other open notes');
		expect(desc).toBe('Expose non-active open notes globally');
	});
});

describe('renderOpenNotesSection — wording: blacklist + global scope', () => {
	it('active-note toggle shows "Allow…through globally" for blacklist global scope', () => {
		const container = renderSandbox();
		renderOpenNotesSection(container, makeState(), 'blacklist', 'global', makeCallbacks());

		const desc = getSettingDesc(container, 'Active note');
		expect(desc).toBe('Allow the currently focused note through globally');
	});

	it('other-notes toggle shows "Allow…through globally" for blacklist global scope', () => {
		const container = renderSandbox();
		renderOpenNotesSection(container, makeState(), 'blacklist', 'global', makeCallbacks());

		const desc = getSettingDesc(container, 'Other open notes');
		expect(desc).toBe('Allow non-active open notes through globally');
	});
});

describe('renderOpenNotesSection — callbacks', () => {
	it('toggling active-note invokes onToggleActive with true when initial value is false', () => {
		const container = renderSandbox();
		const callbacks = makeCallbacks();
		renderOpenNotesSection(container, makeState({allowActiveNote: false}), 'whitelist', 'key', callbacks);

		const toggleEl = getToggle(container, 'Active note');
		expect(toggleEl).not.toBeNull();
		click(toggleEl!);

		expect(callbacks.onToggleActive).toHaveBeenCalledOnce();
		expect(callbacks.onToggleActive).toHaveBeenCalledWith(true);
	});

	it('toggling active-note invokes onToggleActive with false when initial value is true', () => {
		const container = renderSandbox();
		const callbacks = makeCallbacks();
		renderOpenNotesSection(container, makeState({allowActiveNote: true}), 'whitelist', 'key', callbacks);

		const toggleEl = getToggle(container, 'Active note');
		expect(toggleEl).not.toBeNull();
		click(toggleEl!);

		expect(callbacks.onToggleActive).toHaveBeenCalledWith(false);
	});

	it('toggling other-notes invokes onToggleOther with true when initial value is false', () => {
		const container = renderSandbox();
		const callbacks = makeCallbacks();
		renderOpenNotesSection(container, makeState({allowOtherNotes: false}), 'whitelist', 'key', callbacks);

		const toggleEl = getToggle(container, 'Other open notes');
		expect(toggleEl).not.toBeNull();
		click(toggleEl!);

		expect(callbacks.onToggleOther).toHaveBeenCalledOnce();
		expect(callbacks.onToggleOther).toHaveBeenCalledWith(true);
	});

	it('toggling other-notes invokes onToggleOther with false when initial value is true', () => {
		const container = renderSandbox();
		const callbacks = makeCallbacks();
		renderOpenNotesSection(container, makeState({allowOtherNotes: true}), 'whitelist', 'key', callbacks);

		const toggleEl = getToggle(container, 'Other open notes');
		expect(toggleEl).not.toBeNull();
		click(toggleEl!);

		expect(callbacks.onToggleOther).toHaveBeenCalledWith(false);
	});
});
