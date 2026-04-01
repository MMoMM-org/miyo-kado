/**
 * PermissionMatrix — renders a 4×4 resource × CRUD dot grid.
 *
 * Reusable across GlobalSecurityTab and ApiKeyTab. Supports:
 * - Interactive mode: dots toggle permissions on click
 * - Constrained mode: dots disabled where maxPermissions disallows
 * - Read-only mode: all dots non-interactive (for effective permissions)
 */

import type {DataTypePermissions, ListMode} from '../../types/canonical';

const RESOURCES = ['note', 'frontmatter', 'dataviewInlineField', 'file'] as const;
type ResourceKey = typeof RESOURCES[number];

const RESOURCE_LABELS: Record<ResourceKey, string> = {
	note: 'Notes',
	frontmatter: 'Frontmatter',
	dataviewInlineField: 'Dataview',
	file: 'Files',
};

const CRUD_OPS = ['create', 'read', 'update', 'delete'] as const;
type CrudKey = typeof CRUD_OPS[number];
const CRUD_LABELS: Record<CrudKey, string> = {create: 'C', read: 'R', update: 'U', delete: 'D'};

export interface PermissionMatrixOptions {
	/** Ceiling from global area — dots disabled where this is false. */
	maxPermissions?: DataTypePermissions;
	/** When true, all dots are non-interactive. */
	readOnly?: boolean;
	/**
	 * Controls dot display meaning:
	 * - 'whitelist' (default): true → checkmark, false → empty
	 * - 'blacklist': true → empty (not blocked), false → red X (blocked)
	 */
	listMode?: ListMode;
	/** Called when any permission changes. */
	onChange: () => void;
}

function buildDotClass(isOn: boolean, isAllowed: boolean, isBlacklist: boolean): string {
	if (!isAllowed) {
		const stateClass = isBlacklist ? (isOn ? '' : ' is-blocked') : (isOn ? ' is-active' : '');
		return `kado-dot is-disabled${stateClass}`;
	}
	if (isBlacklist) {
		return isOn ? 'kado-dot' : 'kado-dot is-blocked';
	}
	return isOn ? 'kado-dot is-active' : 'kado-dot';
}

export function renderPermissionMatrix(
	containerEl: HTMLElement,
	permissions: DataTypePermissions,
	options: PermissionMatrixOptions,
): void {
	const grid = containerEl.createDiv({cls: 'kado-perm-matrix'});

	// Header row: corner + C R U D
	const header = grid.createDiv({cls: 'kado-perm-row kado-perm-header'});
	header.createDiv({cls: 'kado-perm-label'});
	for (const op of CRUD_OPS) {
		header.createDiv({cls: 'kado-perm-col-label', text: CRUD_LABELS[op], title: op});
	}

	// One row per resource
	for (const resource of RESOURCES) {
		const row = grid.createDiv({cls: 'kado-perm-row'});
		row.createDiv({cls: 'kado-perm-label', text: RESOURCE_LABELS[resource]});

		const flags = permissions[resource];
		const maxFlags = options.maxPermissions?.[resource];

		for (const op of CRUD_OPS) {
			const cell = row.createDiv({cls: 'kado-perm-cell'});
			const isOn = flags[op];
			const isAllowed = !maxFlags || maxFlags[op];
			const isBlacklist = options.listMode === 'blacklist';

			// In blacklist mode: true → empty (not blocked), false → is-blocked (X)
			// In whitelist mode: true → is-active (checkmark), false → empty
			const dotClass = buildDotClass(isOn, isAllowed, isBlacklist);

			const dot = cell.createDiv({
				cls: dotClass,
				title: `${op} — ${RESOURCE_LABELS[resource]}`,
			});
			dot.setAttribute('role', 'checkbox');
			dot.setAttribute('tabindex', '0');
			dot.setAttribute('aria-checked', String(isOn));

			if (!options.readOnly && isAllowed) {
				const toggle = (): void => {
					flags[op] = !flags[op];
					dot.className = buildDotClass(flags[op], true, isBlacklist);
					dot.setAttribute('aria-checked', String(flags[op]));
					options.onChange();
				};
				dot.addEventListener('click', toggle);
				dot.addEventListener('keydown', (e: KeyboardEvent) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						toggle();
					}
				});
			}
		}
	}
}
