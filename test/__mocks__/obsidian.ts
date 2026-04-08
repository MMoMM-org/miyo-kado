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
	contentEl = document.createElement('div');
	constructor(app: App) {
		this.app = app;
	}
	open = vi.fn();
	close = vi.fn();
	onOpen() {}
	onClose() {}
}

export class Notice {
	constructor(public message: string, public timeout?: number) {}
}

export class Setting {
	settingEl = document.createElement('div');
	nameEl = document.createElement('div');
	descEl = augmentEl(document.createElement('div'));
	private _containerEl: HTMLElement;
	private _name = '';

	constructor(containerEl: HTMLElement) {
		this._containerEl = containerEl;
		this._containerEl.appendChild(this.settingEl);
	}

	setName = vi.fn((name: string) => {
		this._name = name;
		this.nameEl.textContent = name;
		this.settingEl.setAttribute('data-setting-name', name);
		return this;
	});
	setDesc = vi.fn(() => this);
	setHeading = vi.fn(() => {
		this.settingEl.classList.add('setting-heading');
		return this;
	});
	addText = vi.fn((cb: (text: TextComponent) => void) => {
		cb(new TextComponent());
		return this;
	});
	addToggle = vi.fn((cb: (toggle: ToggleComponent) => void) => {
		cb(new ToggleComponent());
		return this;
	});
	addDropdown = vi.fn((cb: (dropdown: DropdownComponent) => void) => {
		cb(new DropdownComponent());
		return this;
	});
	addButton = vi.fn((cb: (button: ButtonComponent) => void) => {
		cb(new ButtonComponent());
		return this;
	});
}

// Extend HTMLElement with Obsidian-specific DOM helpers used by setting tabs.
function augmentEl(el: HTMLElement): HTMLElement {
	const any = el as unknown as Record<string, unknown>;

	any['createEl'] = (childTag: string, opts?: {text?: string; cls?: string; type?: string; placeholder?: string; value?: string; href?: string}): HTMLElement => {
		const child = augmentEl(document.createElement(childTag));
		if (opts?.text) child.textContent = opts.text;
		if (opts?.cls) child.className = opts.cls;
		if (opts?.type) (child as HTMLInputElement).type = opts.type;
		if (opts?.placeholder) (child as HTMLInputElement).placeholder = opts.placeholder;
		if (opts?.value) (child as HTMLInputElement).value = opts.value;
		if (opts?.href) (child as HTMLAnchorElement).href = opts.href;
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

class TextComponent {
	setValue = vi.fn(() => this);
	setPlaceholder = vi.fn(() => this);
	onChange = vi.fn((cb: (value: string) => void) => {
		this._onChange = cb;
		return this;
	});
	_onChange?: (value: string) => void;
}

class ToggleComponent {
	setValue = vi.fn(() => this);
	onChange = vi.fn((cb: (value: boolean) => void) => {
		this._onChange = cb;
		return this;
	});
	_onChange?: (value: boolean) => void;
}

class ButtonComponent {
	setButtonText = vi.fn(() => this);
	setCta = vi.fn(() => this);
	setWarning = vi.fn(() => this);
	setIcon = vi.fn(() => this);
	onClick = vi.fn((cb: () => void) => {
		this._onClick = cb;
		return this;
	});
	_onClick?: () => void;
}

class DropdownComponent {
	addOption = vi.fn(() => this);
	setValue = vi.fn(() => this);
	onChange = vi.fn(() => this);
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
