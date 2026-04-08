/**
 * Behavioral tests for PathEntry (M18).
 *
 * Covers: input updates rule.path, traversal is blocked, glob validation is
 * enforced (L4 integration), remove button fires onRemove, permission matrix
 * is embedded.
 */

import {describe, it, expect, vi} from 'vitest';
import {renderPathEntry, type PathRule} from '../../../src/settings/components/PathEntry';
import type {DataTypePermissions} from '../../../src/types/canonical';
import {renderSandbox, typeInto, click} from '../helpers';
import {App} from '../../__mocks__/obsidian';

function emptyPerms(): DataTypePermissions {
	return {
		note: {create: false, read: false, update: false, delete: false},
		frontmatter: {create: false, read: false, update: false, delete: false},
		file: {create: false, read: false, update: false, delete: false},
		dataviewInlineField: {create: false, read: false, update: false, delete: false},
	};
}

function makeRule(path = ''): PathRule {
	return {path, permissions: emptyPerms()};
}

describe('renderPathEntry — layout', () => {
	it('renders a remove button, a path input, a browse button, and a permission matrix', () => {
		const container = renderSandbox();
		const app = new App();
		renderPathEntry(container, makeRule('notes/'), {
			app: app as unknown as Parameters<typeof renderPathEntry>[2]['app'],
			onChange: vi.fn(),
			onRemove: vi.fn(),
		});

		expect(container.querySelector('.kado-remove-btn')).not.toBeNull();
		expect(container.querySelector('.kado-path-input')).not.toBeNull();
		expect(container.querySelector('.kado-browse-btn')).not.toBeNull();
		expect(container.querySelectorAll('.kado-dot').length).toBe(16);
	});

	it('initializes the path input with the current rule value', () => {
		const container = renderSandbox();
		const app = new App();
		renderPathEntry(container, makeRule('notes/daily.md'), {
			app: app as unknown as Parameters<typeof renderPathEntry>[2]['app'],
			onChange: vi.fn(),
			onRemove: vi.fn(),
		});

		const input = container.querySelector('.kado-path-input') as HTMLInputElement;
		expect(input.value).toBe('notes/daily.md');
	});
});

describe('renderPathEntry — input validation', () => {
	it('accepts a valid glob pattern and updates the rule', () => {
		const container = renderSandbox();
		const rule = makeRule();
		const onChange = vi.fn();
		const app = new App();

		renderPathEntry(container, rule, {
			app: app as unknown as Parameters<typeof renderPathEntry>[2]['app'],
			onChange,
			onRemove: vi.fn(),
		});

		const input = container.querySelector('.kado-path-input') as HTMLInputElement;
		typeInto(input, 'notes/**/daily.md');

		expect(rule.path).toBe('notes/**/daily.md');
		expect(onChange).toHaveBeenCalledOnce();
		expect(input.classList.contains('kado-input-error')).toBe(false);
	});

	it('rejects paths containing traversal markers', () => {
		const container = renderSandbox();
		const rule = makeRule('original');
		const onChange = vi.fn();
		const app = new App();

		renderPathEntry(container, rule, {
			app: app as unknown as Parameters<typeof renderPathEntry>[2]['app'],
			onChange,
			onRemove: vi.fn(),
		});

		const input = container.querySelector('.kado-path-input') as HTMLInputElement;
		typeInto(input, '../secrets');

		expect(rule.path).toBe('original');
		expect(onChange).not.toHaveBeenCalled();
		expect(input.classList.contains('kado-input-error')).toBe(true);
	});

	it('rejects absolute paths', () => {
		const container = renderSandbox();
		const rule = makeRule('original');
		const onChange = vi.fn();
		const app = new App();

		renderPathEntry(container, rule, {
			app: app as unknown as Parameters<typeof renderPathEntry>[2]['app'],
			onChange,
			onRemove: vi.fn(),
		});

		const input = container.querySelector('.kado-path-input') as HTMLInputElement;
		typeInto(input, '/etc/passwd');

		expect(rule.path).toBe('original');
		expect(onChange).not.toHaveBeenCalled();
		expect(input.classList.contains('kado-input-error')).toBe(true);
	});

	it('rejects overly complex glob patterns (L4 integration)', () => {
		const container = renderSandbox();
		const rule = makeRule('original');
		const onChange = vi.fn();
		const app = new App();

		renderPathEntry(container, rule, {
			app: app as unknown as Parameters<typeof renderPathEntry>[2]['app'],
			onChange,
			onRemove: vi.fn(),
		});

		const input = container.querySelector('.kado-path-input') as HTMLInputElement;
		typeInto(input, 'a/**/**/**/**/b');

		expect(rule.path).toBe('original');
		expect(onChange).not.toHaveBeenCalled();
		expect(input.classList.contains('kado-input-error')).toBe(true);
	});
});

describe('renderPathEntry — remove button', () => {
	it('calls onRemove when clicked', () => {
		const container = renderSandbox();
		const onRemove = vi.fn();
		const app = new App();

		renderPathEntry(container, makeRule(), {
			app: app as unknown as Parameters<typeof renderPathEntry>[2]['app'],
			onChange: vi.fn(),
			onRemove,
		});

		const removeBtn = container.querySelector('.kado-remove-btn') as HTMLElement;
		click(removeBtn);

		expect(onRemove).toHaveBeenCalledOnce();
	});
});
