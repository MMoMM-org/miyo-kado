/**
 * PathEntry — renders a path row with browse button and permission matrix.
 *
 * Layout: [-remove] [path input] [browse] [4×4 permission matrix]
 */

import {Notice, type App} from 'obsidian';
import type {DataTypePermissions} from '../../types/canonical';
import {validateGlobPattern} from '../../core/glob-match';
import {renderPermissionMatrix, type PermissionMatrixOptions} from './PermissionMatrix';
import {VaultFolderModal} from './VaultFolderModal';

export interface PathRule {
	path: string;
	permissions: DataTypePermissions;
}

export interface PathEntryOptions {
	/** Obsidian App instance for vault folder picker. */
	app: App;
	/** Ceiling permissions from global area (for key-level constraint). */
	maxPermissions?: DataTypePermissions;
	/** Called when path or permissions change. */
	onChange: () => void;
	/** Called when remove button is clicked. */
	onRemove: () => void;
}

export function renderPathEntry(
	containerEl: HTMLElement,
	rule: PathRule,
	options: PathEntryOptions,
): void {
	const row = containerEl.createDiv({cls: 'kado-path-entry'});

	// Remove button
	const removeBtn = row.createEl('button', {cls: 'kado-remove-btn', text: '\u2212', attr: {'aria-label': 'Remove path'}});
	removeBtn.addEventListener('click', options.onRemove);

	// Path input
	const pathInput = row.createEl('input', {
		type: 'text',
		cls: 'kado-path-input',
		placeholder: 'Notes/folder/...',
		value: rule.path,
		attr: {'aria-label': 'Path pattern'},
	});
	pathInput.addEventListener('change', () => {
		const value = pathInput.value.trim();
		// Validate: no traversal, no absolute paths
		if (value.includes('..') || value.startsWith('/') || value.startsWith('\\')) {
			pathInput.addClass('kado-input-error');
			pathInput.setAttribute('aria-invalid', 'true');
			if (value.startsWith('/')) {
				new Notice('/ is not a valid path. Use ** for full vault access or pick a folder.');
			}
			return;
		}
		// Validate glob complexity (length, consecutive **, bare **)
		const validation = validateGlobPattern(value);
		if (!validation.ok) {
			pathInput.addClass('kado-input-error');
			pathInput.setAttribute('aria-invalid', 'true');
			pathInput.title = validation.error;
			new Notice(`Invalid glob pattern: ${validation.error}`);
			return;
		}
		pathInput.removeClass('kado-input-error');
		pathInput.setAttribute('aria-invalid', 'false');
		pathInput.removeAttribute('title');
		for (const warning of validation.warnings) {
			new Notice(`Warning: ${warning}`);
		}
		rule.path = value;
		options.onChange();
	});

	// Browse button
	const browseBtn = row.createEl('button', {cls: 'kado-browse-btn', text: '\ud83d\udcc2', title: 'Browse folders'});
	browseBtn.addEventListener('click', () => {
		new VaultFolderModal(options.app, (path) => {
			rule.path = path;
			pathInput.value = path;
			pathInput.removeClass('kado-input-error');
			options.onChange();
		}).open();
	});

	// Permission matrix
	const matrixContainer = row.createDiv({cls: 'kado-path-matrix'});
	const matrixOptions: PermissionMatrixOptions = {
		maxPermissions: options.maxPermissions,
		onChange: options.onChange,
	};
	renderPermissionMatrix(matrixContainer, rule.permissions, matrixOptions);
}
