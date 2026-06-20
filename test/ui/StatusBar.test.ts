/**
 * Behavioral tests for the StatusBar UI component.
 *
 * The component is driven through structural dependencies (a fake plugin +
 * fake status-bar element), so these tests exercise the colour/tooltip state
 * machine without any Obsidian runtime. Pulse reverts use vitest fake timers.
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {StatusBar, PULSE_MS} from '../../src/ui/StatusBar';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Minimal stand-in for the augmented Obsidian status-bar HTMLElement. */
function makeFakeEl() {
	const classes = new Set<string>();
	const attrs: Record<string, string> = {};
	let text = '';
	const el = {
		classList: {
			add: (...c: string[]) => c.forEach((x) => classes.add(x)),
			remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
			contains: (c: string) => classes.has(c),
		},
		setText: (t: string) => { text = t; },
		setAttribute: (k: string, v: string) => { attrs[k] = v; },
	};
	return {
		el: el as unknown as HTMLElement,
		hasClass: (c: string) => classes.has(c),
		modClasses: () => [...classes].filter((c) => c.startsWith('mod-')),
		title: () => attrs.title,
		aria: () => attrs['aria-label'],
		text: () => text,
	};
}

function makeHarness() {
	const fake = makeFakeEl();
	let clickHandler: ((ev: Event) => void) | undefined;
	const openSettings = vi.fn();
	const plugin = {
		addStatusBarItem: vi.fn(() => fake.el),
		registerDomEvent: vi.fn((_el: HTMLElement, type: string, cb: (ev: Event) => void) => {
			if (type === 'click') clickHandler = cb;
		}),
	};
	const sb = new StatusBar({plugin, openSettings});
	return {sb, fake, openSettings, click: () => clickHandler?.(new Event('click'))};
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('StatusBar — construction', () => {
	it('renders the Kado gate glyph and the base class, starting stopped', () => {
		const {fake} = makeHarness();
		expect(fake.text()).toBe('門');
		expect(fake.hasClass('kado-statusbar')).toBe(true);
		expect(fake.modClasses()).toEqual(['mod-stopped']);
	});

	it('mirrors title into aria-label for screen readers', () => {
		const {fake} = makeHarness();
		expect(fake.aria()).toBe(fake.title());
		expect(fake.title()).toContain('Kado');
	});
});

// ---------------------------------------------------------------------------
// Lifecycle states
// ---------------------------------------------------------------------------

describe('StatusBar — lifecycle states', () => {
	it('setListening shows the listening class with port and key count', () => {
		const {sb, fake} = makeHarness();
		sb.setListening({port: 3000, keyCount: 3});
		expect(fake.modClasses()).toEqual(['mod-listening']);
		expect(fake.title()).toContain('listening');
		expect(fake.title()).toContain('3000');
		expect(fake.title()).toContain('3 keys');
		expect(fake.aria()).toBe(fake.title());
	});

	it('setListening singularises the key count', () => {
		const {sb, fake} = makeHarness();
		sb.setListening({port: 3000, keyCount: 1});
		expect(fake.title()).toContain('1 key');
		expect(fake.title()).not.toContain('1 keys');
	});

	it('setStopped shows the stopped class', () => {
		const {sb, fake} = makeHarness();
		sb.setListening({port: 3000, keyCount: 1});
		sb.setStopped();
		expect(fake.modClasses()).toEqual(['mod-stopped']);
		expect(fake.title()).toContain('off');
	});

	it('setError shows the error class and message, and is sticky', () => {
		vi.useFakeTimers();
		try {
			const {sb, fake} = makeHarness();
			sb.setError('port 3000 in use');
			expect(fake.modClasses()).toEqual(['mod-error']);
			expect(fake.title()).toContain('port 3000 in use');
			vi.advanceTimersByTime(PULSE_MS * 3);
			expect(fake.modClasses()).toEqual(['mod-error']);
		} finally {
			vi.useRealTimers();
		}
	});
});

// ---------------------------------------------------------------------------
// Activity pulses
// ---------------------------------------------------------------------------

describe('StatusBar — activity pulses', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('recordAllowed(read) pulses read then reverts to the resting listening state', () => {
		const {sb, fake} = makeHarness();
		sb.setListening({port: 3000, keyCount: 2});
		sb.recordAllowed(false, 'tomo');
		expect(fake.modClasses()).toEqual(['mod-read']);
		expect(fake.title()).toBe("Kado: read — key 'tomo'");
		vi.advanceTimersByTime(PULSE_MS);
		expect(fake.modClasses()).toEqual(['mod-listening']);
		expect(fake.title()).toContain('listening');
	});

	it('recordAllowed(write) pulses the write class with the key name', () => {
		const {sb, fake} = makeHarness();
		sb.setListening();
		sb.recordAllowed(true, 'kokoro');
		expect(fake.modClasses()).toEqual(['mod-write']);
		expect(fake.title()).toBe("Kado: write — key 'kokoro'");
	});

	it('reverts a pulse to stopped when the server is not listening', () => {
		const {sb, fake} = makeHarness();
		sb.recordAllowed(false, 'tomo'); // resting is still 'stopped'
		expect(fake.modClasses()).toEqual(['mod-read']);
		vi.advanceTimersByTime(PULSE_MS);
		expect(fake.modClasses()).toEqual(['mod-stopped']);
	});

	it('a new pulse before the timer fires replaces the previous one', () => {
		const {sb, fake} = makeHarness();
		sb.setListening();
		sb.recordAllowed(false, 'a');
		vi.advanceTimersByTime(PULSE_MS / 2);
		sb.recordAllowed(true, 'b');
		expect(fake.modClasses()).toEqual(['mod-write']);
		// The first timer must not revert mid-pulse.
		vi.advanceTimersByTime(PULSE_MS / 2);
		expect(fake.modClasses()).toEqual(['mod-write']);
		vi.advanceTimersByTime(PULSE_MS / 2);
		expect(fake.modClasses()).toEqual(['mod-listening']);
	});
});

// ---------------------------------------------------------------------------
// Denied — sticky semantic
// ---------------------------------------------------------------------------

describe('StatusBar — denied (sticky)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('recordDenied is sticky: it does not revert on the pulse timer', () => {
		const {sb, fake} = makeHarness();
		sb.setListening();
		sb.recordDenied('tomo', 'permission');
		expect(fake.modClasses()).toEqual(['mod-denied']);
		expect(fake.title()).toBe("Kado: denied — key 'tomo' (permission)");
		vi.advanceTimersByTime(PULSE_MS * 5);
		expect(fake.modClasses()).toEqual(['mod-denied']);
	});

	it('omits the gate suffix when no gate is given', () => {
		const {sb, fake} = makeHarness();
		sb.recordDenied('tomo');
		expect(fake.title()).toBe("Kado: denied — key 'tomo'");
	});

	it('a subsequent allowed call clears the sticky denial', () => {
		const {sb, fake} = makeHarness();
		sb.setListening();
		sb.recordDenied('tomo', 'permission');
		sb.recordAllowed(false, 'tomo');
		expect(fake.modClasses()).toEqual(['mod-read']);
		vi.advanceTimersByTime(PULSE_MS);
		expect(fake.modClasses()).toEqual(['mod-listening']);
	});
});

// ---------------------------------------------------------------------------
// Click behaviour
// ---------------------------------------------------------------------------

describe('StatusBar — click', () => {
	it('opens settings on click', () => {
		const {openSettings, click} = makeHarness();
		click();
		expect(openSettings).toHaveBeenCalledTimes(1);
	});

	it('clears a sticky denial on click and reverts to the resting state', () => {
		const {sb, fake, openSettings, click} = makeHarness();
		sb.setListening();
		sb.recordDenied('tomo', 'permission');
		click();
		expect(openSettings).toHaveBeenCalledTimes(1);
		expect(fake.modClasses()).toEqual(['mod-listening']);
	});

	it('leaves a non-denied state unchanged on click', () => {
		const {sb, fake, click} = makeHarness();
		sb.setListening({port: 3000, keyCount: 1});
		click();
		expect(fake.modClasses()).toEqual(['mod-listening']);
	});
});
