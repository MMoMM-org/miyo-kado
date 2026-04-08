/**
 * Behavioral tests for TagEntry (M18).
 *
 * Covers: initial display with # prefix, normalization on blur, remove button.
 */

import {describe, it, expect, vi} from 'vitest';
import {renderTagEntry} from '../../../src/settings/components/TagEntry';
import {renderSandbox, click} from '../helpers';
import {App} from '../../__mocks__/obsidian';

describe('renderTagEntry — layout', () => {
	it('renders a remove button, tag input, browse button, and R badge', () => {
		const container = renderSandbox();
		const app = new App();

		renderTagEntry(container, 'project', {
			app: app as unknown as Parameters<typeof renderTagEntry>[2]['app'],
			onChange: vi.fn(),
			onRemove: vi.fn(),
		});

		expect(container.querySelector('.kado-remove-btn')).not.toBeNull();
		expect(container.querySelector('.kado-tag-input')).not.toBeNull();
		expect(container.querySelector('.kado-browse-btn')).not.toBeNull();
		expect(container.querySelector('.kado-tag-read-badge')).not.toBeNull();
	});

	it('displays the tag value with a leading # prefix', () => {
		const container = renderSandbox();
		const app = new App();

		renderTagEntry(container, 'work/projects', {
			app: app as unknown as Parameters<typeof renderTagEntry>[2]['app'],
			onChange: vi.fn(),
			onRemove: vi.fn(),
		});

		const input = container.querySelector('.kado-tag-input') as HTMLInputElement;
		expect(input.value).toBe('#work/projects');
	});

	it('shows an empty input when the tag is empty', () => {
		const container = renderSandbox();
		const app = new App();

		renderTagEntry(container, '', {
			app: app as unknown as Parameters<typeof renderTagEntry>[2]['app'],
			onChange: vi.fn(),
			onRemove: vi.fn(),
		});

		const input = container.querySelector('.kado-tag-input') as HTMLInputElement;
		expect(input.value).toBe('');
	});
});

describe('renderTagEntry — normalization', () => {
	it('normalizes the tag on blur and fires onChange with the non-prefixed value', () => {
		const container = renderSandbox();
		const onChange = vi.fn();
		const app = new App();

		renderTagEntry(container, '', {
			app: app as unknown as Parameters<typeof renderTagEntry>[2]['app'],
			onChange,
			onRemove: vi.fn(),
		});

		const input = container.querySelector('.kado-tag-input') as HTMLInputElement;
		input.value = '#new-tag';
		input.dispatchEvent(new FocusEvent('blur'));

		expect(onChange).toHaveBeenCalledWith('new-tag');
		expect(input.value).toBe('#new-tag');
	});

	it('adds a # prefix on blur when the user types a bare tag', () => {
		const container = renderSandbox();
		const onChange = vi.fn();
		const app = new App();

		renderTagEntry(container, '', {
			app: app as unknown as Parameters<typeof renderTagEntry>[2]['app'],
			onChange,
			onRemove: vi.fn(),
		});

		const input = container.querySelector('.kado-tag-input') as HTMLInputElement;
		input.value = 'bare-tag';
		input.dispatchEvent(new FocusEvent('blur'));

		expect(onChange).toHaveBeenCalledWith('bare-tag');
		expect(input.value).toBe('#bare-tag');
	});
});

describe('renderTagEntry — remove button', () => {
	it('calls onRemove when clicked', () => {
		const container = renderSandbox();
		const onRemove = vi.fn();
		const app = new App();

		renderTagEntry(container, 'x', {
			app: app as unknown as Parameters<typeof renderTagEntry>[2]['app'],
			onChange: vi.fn(),
			onRemove,
		});

		const removeBtn = container.querySelector('.kado-remove-btn') as HTMLElement;
		click(removeBtn);

		expect(onRemove).toHaveBeenCalledOnce();
	});
});
