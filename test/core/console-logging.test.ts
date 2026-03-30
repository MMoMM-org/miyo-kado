/**
 * Behavioral tests for kadoLog and kadoError.
 * Tests the [Kado] prefix formatting through the public API.
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {kadoLog, kadoError} from '../../src/core/logger';

describe('kadoLog', () => {
	let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleDebugSpy.mockRestore();
	});

	it('calls console.debug with [Kado] prefix', () => {
		kadoLog('message');
		expect(consoleDebugSpy).toHaveBeenCalledWith('[Kado] message');
	});

	it('includes structured data as JSON string when provided', () => {
		kadoLog('Server started', {port: 23026});
		expect(consoleDebugSpy).toHaveBeenCalledWith('[Kado] Server started {"port":23026}');
	});

	it('omits data segment when no data is provided', () => {
		kadoLog('Plugin unloaded');
		expect(consoleDebugSpy).toHaveBeenCalledWith('[Kado] Plugin unloaded');
	});

	it('includes all keys in structured data', () => {
		kadoLog('Server started', {host: '127.0.0.1', port: 23026});
		expect(consoleDebugSpy).toHaveBeenCalledWith(
			'[Kado] Server started {"host":"127.0.0.1","port":23026}',
		);
	});
});

describe('kadoError', () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleErrorSpy.mockRestore();
	});

	it('calls console.error with [Kado] prefix', () => {
		kadoError('message');
		expect(consoleErrorSpy).toHaveBeenCalledWith('[Kado] message');
	});

	it('includes structured data as JSON string when provided', () => {
		kadoError('Port in use', {port: 23026});
		expect(consoleErrorSpy).toHaveBeenCalledWith('[Kado] Port in use {"port":23026}');
	});

	it('omits data segment when no data is provided', () => {
		kadoError('Unexpected error');
		expect(consoleErrorSpy).toHaveBeenCalledWith('[Kado] Unexpected error');
	});
});
