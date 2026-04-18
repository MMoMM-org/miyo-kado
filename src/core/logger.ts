/**
 * Logger — opt-in debug logging and always-on error logging with [Kado] prefix.
 *
 * Per Obsidian plugin guidelines ("the developer console should only show
 * error messages"), debug output is gated behind a setting that defaults to
 * off. Error output is always emitted because it indicates a real problem.
 *
 * The debug flag is mutated via setDebugLogging() from the plugin lifecycle
 * (onload + saveSettings) so the logger has no direct dependency on the
 * config layer.
 */

const PREFIX = '[Kado]';

let debugEnabled = false;

/** Enable or disable debug-level logging. Called from plugin onload and saveSettings. */
export function setDebugLogging(enabled: boolean): void {
	debugEnabled = enabled;
}

function format(message: string, data?: Record<string, unknown>): string {
	if (data === undefined) {
		return `${PREFIX} ${message}`;
	}
	return `${PREFIX} ${message} ${JSON.stringify(data)}`;
}

/** Logs a debug-level message to the console with the [Kado] prefix. No-op unless debug logging is enabled. */
export function kadoLog(message: string, data?: Record<string, unknown>): void {
	if (!debugEnabled) return;
	// Use console.log rather than console.debug: Chromium DevTools (and the
	// Obsidian console) hide the "Verbose" level by default, which makes
	// console.debug output invisible unless the user changes the level filter.
	console.log(format(message, data));
}

/** Logs an error-level message to the console with the [Kado] prefix. Always emits. */
export function kadoError(message: string, data?: Record<string, unknown>): void {
	console.error(format(message, data));
}
