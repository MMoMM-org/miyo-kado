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
 *   denied    — last call was rejected (red, sticky until next allowed call or click)
 *
 * Sticky semantics mirror Hakobi's StatusBar: a denial/error persists so the
 * user actually notices it. A denial is cleared by the next ALLOWED call (the
 * vault was successfully touched again) or by clicking (explicit acknowledge,
 * which also opens settings). Read/write pulses are transient and revert to the
 * resting state after PULSE_MS. The tooltip never carries note paths — that
 * detail belongs in the audit log; the status bar only names the acting key.
 */

/** The Kado gate glyph rendered in the status bar. */
const GLYPH = '門';

/** How long an activity pulse stays before reverting to the resting state (ms). */
export const PULSE_MS = 900;

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
	private state: StatusBarState = 'stopped';
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
			// Clicking a sticky denial acknowledges and clears it; always open settings.
			if (this.state === 'denied') this.applyResting();
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

	/** A tool call was rejected. Sticky until the next allowed call or a click. */
	recordDenied(keyLabel: string, gate?: string): void {
		this.clearPulseTimer();
		const suffix = gate ? ` (${gate})` : '';
		this.applyState('denied', `Kado: denied — key '${keyLabel}'${suffix}`);
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
		this.state = state;
		this.el.classList.remove(...ALL_STATE_CLASSES);
		this.el.classList.add(`mod-${state}`);
		this.el.setAttribute('title', tooltip);
		this.el.setAttribute('aria-label', tooltip);
	}
}
