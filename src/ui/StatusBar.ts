/**
 * StatusBar — kanji 門 (the gate, Kado's brand glyph) in Obsidian's status bar,
 * giving the user ambient visibility into an otherwise-invisible background
 * service: Kado exposes the vault to external MCP clients, so a glanceable
 * "who is touching the vault right now" signal is a trust feature, not chrome.
 *
 * Why this file exists: it is a pure UI concern that owns the status-bar DOM
 * element and a small colour state machine. It has NO knowledge of the MCP
 * server, the config, or the audit log — the plugin (Layer 5) resolves events
 * into setListening/recordAllowed/recordDenied calls and passes them in. State
 * is conveyed by CSS class (colour, optional pulse); the textual state always
 * lives in the tooltip + aria-label so nothing is colour-only.
 *
 * States:
 *   stopped   — server disabled / not running (muted)
 *   error     — server failed to bind (red, sticky)
 *   listening — server up, resting/idle
 *   read      — a read/search/open-notes call just ran (transient pulse → resting)
 *   write     — a mutating call (write/delete/rename) just ran (transient pulse)
 *   denied    — last call was rejected (steady red, lingers DENIED_MS → resting)
 *
 * Read/write pulses are brief (PULSE_MS); a denial lingers longer (DENIED_MS)
 * so the user actually notices it, then self-clears — clicking is reserved for
 * opening settings, never doubles as "dismiss the warning". A new ALLOWED call
 * supersedes a lingering denial immediately. The error state (failed server
 * bind) persists until the server state changes, since it is a resting state.
 * The tooltip never carries note paths — that detail belongs in the audit log;
 * the status bar only names the acting key.
 */

/** The Kado gate glyph rendered in the status bar. */
const GLYPH = '門';

/**
 * How long an activity pulse stays lit before reverting to the resting state
 * (ms). Long enough to be unmistakable for a single call; a burst of calls
 * keeps it lit because each call resets the timer.
 */
export const PULSE_MS = 2000;

/**
 * How long a denied call stays red before auto-reverting (ms). Longer than a
 * pulse so the user can notice it, but self-clearing — clicking is reserved for
 * opening settings, not for dismissing the warning.
 */
export const DENIED_MS = 6000;

/** The full set of status-bar states (also the `mod-<state>` CSS class suffix). */
export type StatusBarState =
	| 'stopped'
	| 'error'
	| 'listening'
	| 'read'
	| 'write'
	| 'denied';

/** Resting states the bar returns to once a transient pulse expires. */
type RestingState = 'stopped' | 'error' | 'listening';

const ALL_STATE_CLASSES: readonly string[] = [
	'mod-stopped',
	'mod-error',
	'mod-listening',
	'mod-read',
	'mod-write',
	'mod-denied',
];

/** Optional detail shown in the listening tooltip. */
export interface ListeningInfo {
	port?: number;
	keyCount?: number;
}

/** Structural slice of the host plugin — only what StatusBar needs. */
export interface StatusBarDeps {
	plugin: {
		addStatusBarItem: () => HTMLElement;
		registerDomEvent(el: HTMLElement, type: keyof HTMLElementEventMap, callback: (ev: Event) => void): void;
	};
	/** Open Kado's settings — invoked on click. */
	openSettings: () => void;
}

export class StatusBar {
	private readonly el: HTMLElement;
	/** Resting state a transient pulse reverts to. */
	private resting: RestingState = 'stopped';
	/** Tooltip for the resting state, reused when a pulse reverts. */
	private restingTooltip = 'Kado: server off';
	/** Pending pulse-revert handle — cleared by any new state transition. */
	private pulseTimer: number | null = null;

	constructor(private readonly deps: StatusBarDeps) {
		this.el = deps.plugin.addStatusBarItem();
		this.el.classList.add('kado-statusbar');
		this.el.setText(GLYPH);

		deps.plugin.registerDomEvent(this.el, 'click', () => {
			// Click only opens settings — a denial self-clears, so click never
			// doubles as "dismiss".
			this.deps.openSettings();
		});

		this.applyState('stopped', this.restingTooltip);
	}

	// -------------------------------------------------------------------------
	// Lifecycle transitions (set the resting state)
	// -------------------------------------------------------------------------

	/** Server is up and idle. Optional info enriches the tooltip. */
	setListening(info?: ListeningInfo): void {
		const parts = ['Kado: listening'];
		if (info?.port !== undefined) parts.push(`:${info.port}`);
		if (info?.keyCount !== undefined) {
			parts.push(`· ${info.keyCount} ${info.keyCount === 1 ? 'key' : 'keys'}`);
		}
		this.enterResting('listening', parts.join(' '));
	}

	/** Server is disabled / not running. */
	setStopped(): void {
		this.enterResting('stopped', 'Kado: server off');
	}

	/** Server failed to come up (e.g. port in use). Sticky red. */
	setError(message: string): void {
		this.enterResting('error', `Kado: ${message}`);
	}

	// -------------------------------------------------------------------------
	// Activity transitions
	// -------------------------------------------------------------------------

	/**
	 * An allowed tool call just completed. Pulses read or write (mutating), then
	 * reverts to the resting state. Also clears any prior sticky denial — the
	 * vault was successfully touched again.
	 */
	recordAllowed(mutating: boolean, keyLabel: string): void {
		const kind: StatusBarState = mutating ? 'write' : 'read';
		const verb = mutating ? 'write' : 'read';
		this.clearPulseTimer();
		this.applyState(kind, `Kado: ${verb} — key '${keyLabel}'`);
		this.pulseTimer = window.setTimeout(() => {
			this.pulseTimer = null;
			this.applyResting();
		}, PULSE_MS);
	}

	/**
	 * A tool call was rejected. Lingers as steady red for DENIED_MS so the user
	 * notices, then auto-reverts to the resting state. A new allowed call
	 * supersedes it immediately.
	 */
	recordDenied(keyLabel: string, gate?: string): void {
		this.clearPulseTimer();
		const suffix = gate ? ` (${gate})` : '';
		this.applyState('denied', `Kado: denied — key '${keyLabel}'${suffix}`);
		this.pulseTimer = window.setTimeout(() => {
			this.pulseTimer = null;
			this.applyResting();
		}, DENIED_MS);
	}

	/** Cancels any pending pulse timer. Called by the plugin on unload. */
	dispose(): void {
		this.clearPulseTimer();
	}

	// -------------------------------------------------------------------------
	// Internal
	// -------------------------------------------------------------------------

	private enterResting(resting: RestingState, tooltip: string): void {
		this.resting = resting;
		this.restingTooltip = tooltip;
		this.clearPulseTimer();
		this.applyState(resting, tooltip);
	}

	private applyResting(): void {
		this.applyState(this.resting, this.restingTooltip);
	}

	private clearPulseTimer(): void {
		if (this.pulseTimer !== null) {
			window.clearTimeout(this.pulseTimer);
			this.pulseTimer = null;
		}
	}

	private applyState(state: StatusBarState, tooltip: string): void {
		this.el.classList.remove(...ALL_STATE_CLASSES);
		this.el.classList.add(`mod-${state}`);
		this.el.setAttribute('title', tooltip);
		this.el.setAttribute('aria-label', tooltip);
	}
}
