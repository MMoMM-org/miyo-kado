/**
 * Registers Obsidian's ambient DOM globals (createEl, createFragment) in the jsdom
 * test environment. Obsidian injects these at runtime; source that calls them
 * directly — e.g. settings-description fragments in GeneralTab — needs them present
 * under vitest. Element-scoped helpers (el.createEl/createDiv/…) still come from
 * augmentEl in the obsidian mock; this only covers the free-function forms.
 */
import {augmentEl} from './__mocks__/obsidian';

type ElOpts = {
	text?: string;
	cls?: string;
	type?: string;
	placeholder?: string;
	value?: string;
	href?: string;
	attr?: Record<string, string>;
	title?: string;
};

function makeEl(tag: string, opts?: ElOpts): HTMLElement {
	const el = augmentEl(document.createElement(tag));
	if (opts?.text) el.textContent = opts.text;
	if (opts?.cls) el.className = opts.cls;
	if (opts?.type) (el as HTMLInputElement).type = opts.type;
	if (opts?.placeholder) (el as HTMLInputElement).placeholder = opts.placeholder;
	if (opts?.value) (el as HTMLInputElement).value = opts.value;
	if (opts?.href) (el as HTMLAnchorElement).href = opts.href;
	if (opts?.title) el.title = opts.title;
	if (opts?.attr) {
		for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, v);
	}
	return el;
}

const g = globalThis as unknown as Record<string, unknown>;

g['createEl'] = (tag: string, opts?: ElOpts): HTMLElement => makeEl(tag, opts);

g['createFragment'] = (callback?: (frag: DocumentFragment) => void): DocumentFragment => {
	const frag = document.createDocumentFragment();
	(frag as unknown as Record<string, unknown>)['createEl'] = (tag: string, opts?: ElOpts): HTMLElement => {
		const child = makeEl(tag, opts);
		frag.appendChild(child);
		return child;
	};
	callback?.(frag);
	return frag;
};
