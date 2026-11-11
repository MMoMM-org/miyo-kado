/**
 * Behavioral tests for TagRulesSection (#81): the "Only notes tagged" /
 * "Never notes tagged" editor shared by the global security and API key tabs.
 */

import {describe, it, expect, vi} from 'vitest';
import {renderTagRulesSection} from '../../../src/settings/components/TagRulesSection';
import type {TagRuleLists} from '../../../src/settings/components/TagRulesSection';
import {renderSandbox, click} from '../helpers';
import {App} from '../../__mocks__/obsidian';

function render(rules: TagRuleLists) {
	const container = renderSandbox();
	const onSave = vi.fn();
	const onRedisplay = vi.fn();
	renderTagRulesSection(container, rules, {
		app: new App() as unknown as Parameters<typeof renderTagRulesSection>[2]['app'],
		onSave,
		onRedisplay,
	});
	return {container, onSave, onRedisplay};
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
	return Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement;
}

describe('renderTagRulesSection', () => {
	it('renders a Tag rules label, both lists and the deny-wins hint', () => {
		const {container} = render({tagAllow: [], tagDeny: []});
		const labels = Array.from(container.querySelectorAll('.kado-section-label')).map((el) => el.textContent);
		expect(labels).toContain('Tag rules');
		expect(container.textContent).toContain('Only notes tagged');
		expect(container.textContent).toContain('Never notes tagged');
		expect(container.textContent).toContain('Deny wins');
	});

	it('renders one entry per rule with an Allow or Deny badge', () => {
		const {container} = render({tagAllow: ['Work', 'Team'], tagDeny: ['Private']});
		const badges = Array.from(container.querySelectorAll('.kado-tag-read-badge')).map((el) => el.textContent);
		expect(badges).toEqual(['Allow', 'Allow', 'Deny']);
		const values = Array.from(container.querySelectorAll<HTMLInputElement>('.kado-tag-input')).map((el) => el.value);
		expect(values).toEqual(['#Work', '#Team', '#Private']);
	});

	it('adding an allowed tag appends an empty entry, saves and redisplays', () => {
		const rules = {tagAllow: ['Work'], tagDeny: []};
		const {container, onSave, onRedisplay} = render(rules);
		click(button(container, '+ add allowed tag'));
		expect(rules.tagAllow).toEqual(['Work', '']);
		expect(onSave).toHaveBeenCalled();
		expect(onRedisplay).toHaveBeenCalled();
	});

	it('adding a denied tag appends to tagDeny', () => {
		const rules = {tagAllow: [], tagDeny: []};
		const {container} = render(rules);
		click(button(container, '+ add denied tag'));
		expect(rules.tagDeny).toEqual(['']);
	});

	it('editing an entry updates the list and saves without redisplay', () => {
		const rules = {tagAllow: ['Work'], tagDeny: []};
		const {container, onSave, onRedisplay} = render(rules);
		const input = container.querySelector<HTMLInputElement>('.kado-tag-input')!;
		input.value = '#Team';
		input.dispatchEvent(new Event('blur'));
		expect(rules.tagAllow).toEqual(['Team']);
		expect(onSave).toHaveBeenCalled();
		expect(onRedisplay).not.toHaveBeenCalled();
	});

	it('removing an entry removes it from its list', () => {
		const rules = {tagAllow: [], tagDeny: ['Private', 'Secret']};
		const {container, onRedisplay} = render(rules);
		click(container.querySelectorAll<HTMLButtonElement>('.kado-remove-btn')[0]!);
		expect(rules.tagDeny).toEqual(['Secret']);
		expect(onRedisplay).toHaveBeenCalled();
	});
});
