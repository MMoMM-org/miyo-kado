/**
 * Behavioral tests for PermissionMatrix (M18).
 *
 * Covers: dot click toggles permission flag, constrained dots are
 * non-interactive, keyboard (Space/Enter) also toggles, read-only mode
 * disables all dots, onChange fires per toggle.
 */

import {describe, it, expect, vi} from 'vitest';
import {renderPermissionMatrix} from '../../../src/settings/components/PermissionMatrix';
import type {DataTypePermissions} from '../../../src/types/canonical';
import {renderSandbox, click} from '../helpers';

function emptyPermissions(): DataTypePermissions {
	return {
		note: {create: false, read: false, update: false, delete: false},
		frontmatter: {create: false, read: false, update: false, delete: false},
		file: {create: false, read: false, update: false, delete: false},
		dataviewInlineField: {create: false, read: false, update: false, delete: false},
	};
}

function allPermissions(): DataTypePermissions {
	return {
		note: {create: true, read: true, update: true, delete: true},
		frontmatter: {create: true, read: true, update: true, delete: true},
		file: {create: true, read: true, update: true, delete: true},
		dataviewInlineField: {create: true, read: true, update: true, delete: true},
	};
}

describe('renderPermissionMatrix — rendering', () => {
	it('renders a fieldset with 16 interactive dots in default mode', () => {
		const container = renderSandbox();
		const onChange = vi.fn();

		renderPermissionMatrix(container, emptyPermissions(), {onChange});

		const dots = container.querySelectorAll('.kado-dot');
		expect(dots).toHaveLength(16);
	});

	it('marks dots with role=checkbox and aria-checked reflecting the permission', () => {
		const container = renderSandbox();
		const perms = emptyPermissions();
		perms.note.read = true;
		renderPermissionMatrix(container, perms, {onChange: vi.fn()});

		const noteReadDot = container.querySelector('[aria-label="read Notes"]');
		expect(noteReadDot?.getAttribute('role')).toBe('checkbox');
		expect(noteReadDot?.getAttribute('aria-checked')).toBe('true');
	});
});

describe('renderPermissionMatrix — interactivity', () => {
	it('clicking an enabled dot toggles the permission and fires onChange', () => {
		const container = renderSandbox();
		const perms = emptyPermissions();
		const onChange = vi.fn();

		renderPermissionMatrix(container, perms, {onChange});

		const dot = container.querySelector('[aria-label="read Notes"]') as HTMLElement;
		click(dot);

		expect(perms.note.read).toBe(true);
		expect(onChange).toHaveBeenCalledOnce();
		expect(dot.getAttribute('aria-checked')).toBe('true');
	});

	it('clicking an already-on dot turns it off', () => {
		const container = renderSandbox();
		const perms = allPermissions();
		const onChange = vi.fn();

		renderPermissionMatrix(container, perms, {onChange});

		const dot = container.querySelector('[aria-label="create Files"]') as HTMLElement;
		click(dot);

		expect(perms.file.create).toBe(false);
		expect(onChange).toHaveBeenCalledOnce();
	});

	it('does not toggle disabled dots (outside maxPermissions ceiling)', () => {
		const container = renderSandbox();
		const perms = emptyPermissions();
		const maxPerms = emptyPermissions();
		// Allow only note.read in the ceiling
		maxPerms.note.read = true;
		const onChange = vi.fn();

		renderPermissionMatrix(container, perms, {maxPermissions: maxPerms, onChange});

		const deniedDot = container.querySelector('[aria-label="create Notes"]') as HTMLElement;
		expect(deniedDot.getAttribute('aria-disabled')).toBe('true');

		click(deniedDot);

		expect(perms.note.create).toBe(false);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('read-only mode disables all interactions even when no ceiling is set', () => {
		const container = renderSandbox();
		const perms = emptyPermissions();
		const onChange = vi.fn();

		renderPermissionMatrix(container, perms, {readOnly: true, onChange});

		const dot = container.querySelector('[aria-label="read Notes"]') as HTMLElement;
		click(dot);

		expect(perms.note.read).toBe(false);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('keyboard Enter on an enabled dot toggles the permission', () => {
		const container = renderSandbox();
		const perms = emptyPermissions();
		const onChange = vi.fn();

		renderPermissionMatrix(container, perms, {onChange});

		const dot = container.querySelector('[aria-label="update Notes"]') as HTMLElement;
		dot.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));

		expect(perms.note.update).toBe(true);
		expect(onChange).toHaveBeenCalledOnce();
	});

	it('keyboard Space on an enabled dot toggles the permission', () => {
		const container = renderSandbox();
		const perms = emptyPermissions();
		const onChange = vi.fn();

		renderPermissionMatrix(container, perms, {onChange});

		const dot = container.querySelector('[aria-label="delete Files"]') as HTMLElement;
		dot.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', bubbles: true}));

		expect(perms.file.delete).toBe(true);
		expect(onChange).toHaveBeenCalledOnce();
	});
});

describe('renderPermissionMatrix — blacklist mode', () => {
	it('renders dots with blocked state when listMode is blacklist and flag is false', () => {
		const container = renderSandbox();
		const perms = emptyPermissions();
		perms.note.read = false; // blocked in blacklist terminology
		perms.note.create = true; // not blocked

		renderPermissionMatrix(container, perms, {onChange: vi.fn(), listMode: 'blacklist'});

		const blockedDot = container.querySelector('[aria-label="read Notes"]');
		const allowedDot = container.querySelector('[aria-label="create Notes"]');
		expect(blockedDot?.className).toContain('is-blocked');
		expect(allowedDot?.className).not.toContain('is-blocked');
	});
});
