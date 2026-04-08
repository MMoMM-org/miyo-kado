/**
 * Lightweight Obsidian API mock for unit testing.
 * Provides minimal stubs of the classes and functions used in the plugin.
 */

import {vi} from 'vitest';

// --- Core types ---

export interface TagCache {
	tag: string;
	position?: unknown;
}

export interface CachedMetadata {
	tags?: TagCache[];
	frontmatter?: Record<string, unknown>;
}

// --- App & Workspace ---

export class Component {
	registerDomEvent = vi.fn();
	registerInterval = vi.fn();
	registerEvent = vi.fn();
}

export class App {
	vault = {
		getAbstractFileByPath: vi.fn(),
		getFileByPath: vi.fn(),
		read: vi.fn(),
		create: vi.fn(),
		modify: vi.fn(),
		// process: atomic read-modify-write. The transform callback receives the
		// current file content as a string and must return the new content.
		// Tests stub this via vi.mocked(app.vault.process).mockImplementation(...)
		// when they need realistic behaviour; otherwise it returns undefined.
		process: vi.fn(),
		delete: vi.fn(),
		trash: vi.fn(),
		readBinary: vi.fn(),
		createBinary: vi.fn(),
		modifyBinary: vi.fn(),
		getMarkdownFiles: vi.fn(() => [] as TFile[]),
		getFiles: vi.fn(() => [] as TFile[]),
		getAllLoadedFiles: vi.fn(() => [] as (TFile | TFolder)[]),
		adapter: {read: vi.fn(), write: vi.fn(), exists: vi.fn(), stat: vi.fn(async () => null), rename: vi.fn(), remove: vi.fn()},
		configDir: '.obsidian',
	};
	fileManager = {
		processFrontMatter: vi.fn(),
	};
	workspace = {
		getActiveViewOfType: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		getLeavesOfType: vi.fn(() => []),
		openLinkText: vi.fn(async () => {}),
	};
	metadataCache = {
		getFileCache: vi.fn((_file: TFile): CachedMetadata | null => null),
		on: vi.fn(),
	};
}

// --- Plugin ---

export class Plugin extends Component {
	app: App;
	manifest = {id: 'test-plugin', name: 'Test Plugin', version: '0.0.0'};
	private _cleanupFns: Array<() => unknown> = [];

	constructor(app?: App) {
		super();
		this.app = app ?? new App();
	}

	loadData = vi.fn(async () => ({}));
	saveData = vi.fn(async () => {});
	addRibbonIcon = vi.fn(() => document.createElement('div'));
	addStatusBarItem = vi.fn(() => ({setText: vi.fn()}));
	addCommand = vi.fn();
	addSettingTab = vi.fn();
	register = vi.fn((fn: () => unknown) => {
		this._cleanupFns.push(fn);
	});

	/** Simulate Obsidian calling all registered cleanup functions (for testing onunload). */
	_runCleanup(): void {
		for (const fn of this._cleanupFns) fn();
	}
}

// --- UI Components ---

export class Modal {
	app: App;
	contentEl: HTMLElement;
	constructor(app: App) {
		this.app = app;
		this.contentEl = augmentEl(document.createElement('div'));
	}
	open = vi.fn(() => {
		this.onOpen();
	});
	close = vi.fn(() => {
		this.onClose();
	});
	onOpen(): void {}
	onClose(): void {}
}

export class Notice {
	constructor(public message: string, public timeout?: number) {}
}

export class Setting {
	settingEl = document.createElement('div');
	nameEl = document.createElement('div');
	descEl = augmentEl(document.createElement('div'));
	private _containerEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		this._containerEl = containerEl;
		this.settingEl.appendChild(this.nameEl);
		this.settingEl.appendChild(this.descEl);
		this._containerEl.appendChild(this.settingEl);
	}

	setName = vi.fn((name: string) => {
		this.nameEl.textContent = name;
		this.settingEl.setAttribute('data-setting-name', name);
		return this;
	});
	setDesc = vi.fn((desc: string) => {
		this.descEl.textContent = desc;
		return this;
	});
	setHeading = vi.fn(() => {
		this.settingEl.classList.add('setting-heading');
		return this;
	});
	addText = vi.fn((cb: (text: TextComponent) => void) => {
		const text = new TextComponent();
		this.settingEl.appendChild(text.inputEl);
		cb(text);
		return this;
	});
	addToggle = vi.fn((cb: (toggle: ToggleComponent) => void) => {
		const toggle = new ToggleComponent();
		this.settingEl.appendChild(toggle.toggleEl);
		cb(toggle);
		return this;
	});
	addDropdown = vi.fn((cb: (dropdown: DropdownComponent) => void) => {
		const dropdown = new DropdownComponent();
		this.settingEl.appendChild(dropdown.selectEl);
		cb(dropdown);
		return this;
	});
	addButton = vi.fn((cb: (button: ButtonComponent) => void) => {
		const button = new ButtonComponent();
		this.settingEl.appendChild(button.buttonEl);
		cb(button);
		return this;
	});
}

// Extend HTMLElement with Obsidian-specific DOM helpers used by setting tabs.
function augmentEl(el: HTMLElement): HTMLElement {
	const any = el as unknown as Record<string, unknown>;

	any['createEl'] = (childTag: string, opts?: {text?: string; cls?: string; type?: string; placeholder?: string; value?: string; href?: string; attr?: Record<string, string>; title?: string}): HTMLElement => {
		const child = augmentEl(document.createElement(childTag));
		if (opts?.text) child.textContent = opts.text;
		if (opts?.cls) child.className = opts.cls;
		if (opts?.type) (child as HTMLInputElement).type = opts.type;
		if (opts?.placeholder) (child as HTMLInputElement).placeholder = opts.placeholder;
		if (opts?.value) (child as HTMLInputElement).value = opts.value;
		if (opts?.href) (child as HTMLAnchorElement).href = opts.href;
		if (opts?.title) child.title = opts.title;
		if (opts?.attr) {
			for (const [k, v] of Object.entries(opts.attr)) child.setAttribute(k, v);
		}
		el.appendChild(child);
		return child;
	};

	any['createDiv'] = (opts?: {cls?: string; text?: string}): HTMLElement => {
		const div = augmentEl(document.createElement('div'));
		if (opts?.cls) div.className = opts.cls;
		if (opts?.text) div.textContent = opts.text;
		el.appendChild(div);
		return div;
	};

	any['createSpan'] = (opts?: {cls?: string; text?: string}): HTMLElement => {
		const span = augmentEl(document.createElement('span'));
		if (opts?.cls) span.className = opts.cls;
		if (opts?.text) span.textContent = opts.text;
		el.appendChild(span);
		return span;
	};

	any['empty'] = (): void => {
		while (el.firstChild) el.removeChild(el.firstChild);
	};

	any['addClass'] = (...classes: string[]): void => {
		el.classList.add(...classes);
	};

	any['removeClass'] = (...classes: string[]): void => {
		el.classList.remove(...classes);
	};

	any['toggleClass'] = (cls: string, force?: boolean): void => {
		el.classList.toggle(cls, force);
	};

	return el;
}

function makeObsidianEl(tag = 'div'): HTMLElement {
	return augmentEl(document.createElement(tag));
}

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl = makeObsidianEl('div');
	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
	}
	display() {}
	hide() {}
}

// --- UI Primitives ---

/**
 * TextComponent — exposes `inputEl` so tests can set value and fire events
 * directly. Bound via `addText(cb => cb.onChange(...))` in production code.
 */
class TextComponent {
	inputEl: HTMLInputElement;
	_onChange?: (value: string) => void;

	constructor() {
		this.inputEl = document.createElement('input');
		this.inputEl.type = 'text';
	}

	setValue = vi.fn((v: string) => {
		this.inputEl.value = v;
		return this;
	});
	setPlaceholder = vi.fn((p: string) => {
		this.inputEl.placeholder = p;
		return this;
	});
	onChange = vi.fn((cb: (value: string) => void) => {
		this._onChange = cb;
		this.inputEl.addEventListener('input', () => cb(this.inputEl.value));
		return this;
	});
}

/**
 * ToggleComponent — exposes `toggleEl` so tests can click to flip state.
 */
class ToggleComponent {
	toggleEl: HTMLElement;
	_value = false;
	_onChange?: (value: boolean) => void;

	constructor() {
		this.toggleEl = document.createElement('div');
		this.toggleEl.setAttribute('role', 'switch');
		this.toggleEl.addEventListener('click', () => {
			this._value = !this._value;
			this.toggleEl.setAttribute('aria-checked', String(this._value));
			this._onChange?.(this._value);
		});
	}

	setValue = vi.fn((v: boolean) => {
		this._value = v;
		this.toggleEl.setAttribute('aria-checked', String(v));
		return this;
	});
	onChange = vi.fn((cb: (value: boolean) => void) => {
		this._onChange = cb;
		return this;
	});
}

/**
 * ButtonComponent — exposes `buttonEl` so tests can dispatch real clicks.
 */
class ButtonComponent {
	buttonEl: HTMLButtonElement;
	_onClick?: () => void;

	constructor() {
		this.buttonEl = document.createElement('button');
		this.buttonEl.addEventListener('click', () => this._onClick?.());
	}

	setButtonText = vi.fn((text: string) => {
		this.buttonEl.textContent = text;
		return this;
	});
	setCta = vi.fn(() => {
		this.buttonEl.classList.add('mod-cta');
		return this;
	});
	setWarning = vi.fn(() => {
		this.buttonEl.classList.add('mod-warning');
		return this;
	});
	setIcon = vi.fn(() => this);
	setTooltip = vi.fn((text: string) => {
		this.buttonEl.setAttribute('aria-label', text);
		return this;
	});
	onClick = vi.fn((cb: () => void) => {
		this._onClick = cb;
		return this;
	});
}

/**
 * DropdownComponent — exposes `selectEl` (an HTMLSelectElement) so tests can
 * set the value and dispatch a change event.
 */
class DropdownComponent {
	selectEl: HTMLSelectElement;
	_onChange?: (value: string) => void;

	constructor() {
		this.selectEl = document.createElement('select');
		this.selectEl.addEventListener('change', () => {
			this._onChange?.(this.selectEl.value);
		});
	}

	addOption = vi.fn((value: string, display: string) => {
		const opt = document.createElement('option');
		opt.value = value;
		opt.textContent = display;
		this.selectEl.appendChild(opt);
		return this;
	});
	setValue = vi.fn((v: string) => {
		this.selectEl.value = v;
		return this;
	});
	onChange = vi.fn((cb: (value: string) => void) => {
		this._onChange = cb;
		return this;
	});
}

// --- Views ---

export class MarkdownView {
	editor = {
		replaceSelection: vi.fn(),
		getValue: vi.fn(() => ''),
		setValue: vi.fn(),
		getSelection: vi.fn(() => ''),
	};
	file = null;
}

export class Editor {
	replaceSelection = vi.fn();
	getValue = vi.fn(() => '');
	setValue = vi.fn();
	getSelection = vi.fn(() => '');
}

// --- File System ---

export class TFile {
	path = 'test.md';
	name = 'test.md';
	basename = 'test';
	extension = 'md';
	vault = {};
	parent: TFolder | null = null;
	stat = {ctime: 1000, mtime: 2000, size: 100};
}

export class TFolder {
	path = 'test-folder';
	name = 'test-folder';
	children: (TFile | TFolder)[] = [];
}

// --- Events ---

export class Events {
	on = vi.fn();
	off = vi.fn();
	trigger = vi.fn();
}

// --- Utilities ---

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export const getAllTags = vi.fn((_cache: CachedMetadata): string[] | null => null);

// --- Factories ---

export function createMockTFile(overrides?: Partial<{
	path: string;
	name: string;
	basename: string;
	extension: string;
	stat: Partial<{ctime: number; mtime: number; size: number}>;
}>): TFile {
	const file = new TFile();
	if (overrides?.path !== undefined) file.path = overrides.path;
	if (overrides?.name !== undefined) file.name = overrides.name;
	if (overrides?.basename !== undefined) file.basename = overrides.basename;
	if (overrides?.extension !== undefined) file.extension = overrides.extension;
	if (overrides?.stat) {
		file.stat = {
			ctime: overrides.stat.ctime ?? 1000,
			mtime: overrides.stat.mtime ?? 2000,
			size: overrides.stat.size ?? 100,
		};
	}
	return file;
}

export function createMockCachedMetadata(overrides?: Partial<{
	tags: TagCache[];
	frontmatter: Record<string, unknown>;
}>): CachedMetadata {
	return {
		tags: overrides?.tags ?? [],
		frontmatter: overrides?.frontmatter ?? {},
	};
}
