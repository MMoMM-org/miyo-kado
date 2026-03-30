/**
 * Lightweight Obsidian API mock for unit testing.
 * Provides minimal stubs of the classes and functions used in the plugin.
 */

import {vi} from 'vitest';

// --- App & Workspace ---

export class Component {
	registerDomEvent = vi.fn();
	registerInterval = vi.fn();
	registerEvent = vi.fn();
}

export class App {
	vault = {
		getAbstractFileByPath: vi.fn(),
		read: vi.fn(),
		create: vi.fn(),
		modify: vi.fn(),
		adapter: {read: vi.fn(), write: vi.fn(), exists: vi.fn()},
	};
	workspace = {
		getActiveViewOfType: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		getLeavesOfType: vi.fn(() => []),
	};
	metadataCache = {
		getFileCache: vi.fn(),
		on: vi.fn(),
	};
}

// --- Plugin ---

export class Plugin extends Component {
	app: App;
	manifest = {id: 'test-plugin', name: 'Test Plugin', version: '0.0.0'};

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
	constructor(_containerEl: HTMLElement) {}
	setName = vi.fn(() => this);
	setDesc = vi.fn(() => this);
	setHeading = vi.fn(() => this);
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
}

// Extend HTMLElement with Obsidian-specific DOM helpers used by setting tabs.
function makeObsidianEl(tag = 'div'): HTMLElement {
	const el = document.createElement(tag);
	// Obsidian's createEl — creates a child element and appends it.
	(el as unknown as Record<string, unknown>)['createEl'] = <K extends keyof HTMLElementTagNameMap>(
		childTag: K,
		opts?: {text?: string; cls?: string},
	): HTMLElement => {
		const child = document.createElement(childTag);
		if (opts?.text) child.textContent = opts.text;
		if (opts?.cls) child.className = opts.cls;
		el.appendChild(child);
		return child;
	};
	// Obsidian's empty — removes all child nodes.
	(el as unknown as Record<string, unknown>)['empty'] = (): void => {
		while (el.firstChild) el.removeChild(el.firstChild);
	};
	return el;
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
	onChange = vi.fn(() => this);
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
