/**
 * OpenNotesSection — pure-presentational component for the Open Notes toggles.
 *
 * Renders a labelled section with two toggles controlling whether the active
 * note and other open notes are exposed (whitelist) or allowed through
 * (blacklist) for a given scope. No plugin coupling — callbacks handle
 * persistence at the call site.
 */

import {Setting} from 'obsidian';
import type {ListMode} from '../../types/canonical';

export interface OpenNotesSectionState {
	allowActiveNote: boolean;
	allowOtherNotes: boolean;
}

export interface OpenNotesSectionCallbacks {
	onToggleActive: (value: boolean) => void;
	onToggleOther: (value: boolean) => void;
}

/** Whether the component is used at the global level or for a specific key. */
export type OpenNotesScopeContext = 'global' | 'key';

const WORDING = {
	whitelist: {
		key: {
			active: 'Expose the currently focused note to this key',
			other: 'Expose non-active open notes to this key',
		},
		global: {
			active: 'Expose the currently focused note globally',
			other: 'Expose non-active open notes globally',
		},
	},
	blacklist: {
		key: {
			active: 'Allow the currently focused note through to this key',
			other: 'Allow non-active open notes through to this key',
		},
		global: {
			active: 'Allow the currently focused note through globally',
			other: 'Allow non-active open notes through globally',
		},
	},
} as const satisfies Record<ListMode, Record<OpenNotesScopeContext, Record<'active' | 'other', string>>>;

export function renderOpenNotesSection(
	containerEl: HTMLElement,
	state: OpenNotesSectionState,
	listMode: ListMode,
	scope: OpenNotesScopeContext,
	callbacks: OpenNotesSectionCallbacks,
): void {
	containerEl.createDiv({cls: 'kado-section-label', text: 'Open Notes'});

	const wording = WORDING[listMode][scope];

	new Setting(containerEl)
		.setName('Active note')
		.setDesc(wording.active)
		.addToggle(toggle => toggle
			.setValue(state.allowActiveNote)
			.onChange((value: boolean) => {
				callbacks.onToggleActive(value);
			}));

	new Setting(containerEl)
		.setName('Other open notes')
		.setDesc(wording.other)
		.addToggle(toggle => toggle
			.setValue(state.allowOtherNotes)
			.onChange((value: boolean) => {
				callbacks.onToggleOther(value);
			}));
}
