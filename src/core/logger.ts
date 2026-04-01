/**
 * Logger — always-on console logging with [Kado] prefix.
 *
 * Provides a thin wrapper around console.log/error for consistent
 * identification of Kado messages in the Obsidian developer console.
 * Not toggleable — active for the full plugin lifecycle.
 */

const PREFIX = '[Kado]';

function format(message: string, data?: Record<string, unknown>): string {
	if (data === undefined) {
		return `${PREFIX} ${message}`;
	}
	return `${PREFIX} ${message} ${JSON.stringify(data)}`;
}

/** Logs a debug-level message to the console with the [Kado] prefix. */
export function kadoLog(message: string, data?: Record<string, unknown>): void {
	console.debug(format(message, data));
}

/** Logs an error-level message to the console with the [Kado] prefix. */
export function kadoError(message: string, data?: Record<string, unknown>): void {
	console.error(format(message, data));
}
