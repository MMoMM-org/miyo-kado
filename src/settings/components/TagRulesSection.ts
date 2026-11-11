/**
 * TagRulesSection — editor for tag access rules (#81), shared by the global
 * security tab and the API key tab.
 *
 * Renders two tag lists — "Only notes tagged" (tagAllow) and "Never notes
 * tagged" (tagDeny) — with the deny-wins / untagged-blocked hint. Edits mutate
 * the passed lists in place and save; only structural changes (add/remove)
 * redisplay, so typing never loses focus.
 */

import type {App} from 'obsidian';
import {renderTagEntry} from './TagEntry';

/** The two rule lists of a scope (SecurityConfig or ApiKeyConfig). */
export interface TagRuleLists {
	tagAllow: string[];
	tagDeny: string[];
}

export interface TagRulesSectionOptions {
	app: App;
	/** Persists the config after any change. */
	onSave: () => void;
	/** Re-renders after structural changes (entry added/removed). */
	onRedisplay: () => void;
}

interface RuleListSpec {
	list: string[];
	label: string;
	addText: string;
	badge: {text: string; title: string};
}

export function renderTagRulesSection(parentEl: HTMLElement, rules: TagRuleLists, options: TagRulesSectionOptions): void {
	const containerEl = parentEl.createDiv({cls: 'kado-tag-rules'});
	containerEl.createDiv({cls: 'kado-section-label', text: 'Tag rules'});
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'Applies to notes only — files use path rules. Deny wins. '
			+ 'Untagged notes are blocked when "Only notes tagged" is set; an empty list means no restriction.',
	});

	const specs: RuleListSpec[] = [
		{list: rules.tagAllow, label: 'Only notes tagged', addText: '+ add allowed tag', badge: {text: 'Allow', title: 'A note must carry one of these tags'}},
		{list: rules.tagDeny, label: 'Never notes tagged', addText: '+ add denied tag', badge: {text: 'Deny', title: 'Notes carrying this tag are denied'}},
	];
	for (const spec of specs) renderRuleList(containerEl, spec, options);
}

function renderRuleList(containerEl: HTMLElement, spec: RuleListSpec, options: TagRulesSectionOptions): void {
	containerEl.createDiv({cls: 'kado-tag-rule-label', text: spec.label});
	const listEl = containerEl.createDiv();
	for (let i = 0; i < spec.list.length; i++) {
		renderTagEntry(listEl, spec.list[i] ?? '', {
			app: options.app,
			badge: spec.badge,
			onChange: (newTag) => {
				spec.list[i] = newTag;
				options.onSave();
			},
			onRemove: () => {
				spec.list.splice(i, 1);
				options.onSave();
				options.onRedisplay();
			},
		});
	}
	const addBtn = containerEl.createEl('button', {cls: 'kado-add-btn', text: spec.addText});
	addBtn.addEventListener('click', () => {
		spec.list.push('');
		options.onSave();
		options.onRedisplay();
	});
}
