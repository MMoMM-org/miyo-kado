/**
 * PermissionMatrix — renders a 4×4 resource × CRUD dot grid.
 *
 * Reusable across GlobalSecurityTab and ApiKeyTab. Supports:
 * - Interactive mode: dots toggle permissions on click
 * - Constrained mode: dots disabled where maxPermissions disallows
 * - Read-only mode: all dots non-interactive (for effective permissions)
 */

import type {DataTypePermissions} from '../../types/canonical';

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
	/** Called when any permission changes. */
	onChange: () => void;
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

			const dot = cell.createDiv({
				cls: `kado-dot${isOn ? ' is-active' : ''}${!isAllowed ? ' is-disabled' : ''}`,
				title: `${op} — ${RESOURCE_LABELS[resource]}`,
			});
			dot.setAttribute('role', 'checkbox');
			dot.setAttribute('tabindex', '0');
			dot.setAttribute('aria-checked', String(isOn));

			if (!options.readOnly && isAllowed) {
				const toggle = (): void => {
					flags[op] = !flags[op];
					dot.toggleClass('is-active', flags[op]);
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
