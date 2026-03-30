/**
 * Behavioral tests for FileAdapter (binary/non-markdown files).
 *
 * Tests the behavior of createFileAdapter() through its ReadWriteAdapter
 * public interface — read() and write(). Vault interactions are mocked inline.
 * Does NOT modify test/__mocks__/obsidian.ts.
 */

import {describe, it, expect, vi} from 'vitest';
import {createFileAdapter} from '../../src/obsidian/file-adapter';
import type {CoreReadRequest, CoreWriteRequest} from '../../src/types/canonical';

// ---------------------------------------------------------------------------
// Inline mock types — mirrors Obsidian's TFile and Vault shapes
// ---------------------------------------------------------------------------

interface MockStat {
	ctime: number;
	mtime: number;
	size: number;
}

interface MockTFile {
	path: string;
	stat: MockStat;
}

interface MockVault {
	getFileByPath: ReturnType<typeof vi.fn>;
	readBinary: ReturnType<typeof vi.fn>;
	createBinary: ReturnType<typeof vi.fn>;
	modifyBinary: ReturnType<typeof vi.fn>;
}

interface MockApp {
	vault: MockVault;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeTFile(overrides?: Partial<MockTFile & {stat: Partial<MockStat>}>): MockTFile {
	return {
		path: overrides?.path ?? 'assets/image.png',
		stat: {
			ctime: overrides?.stat?.ctime ?? 1000,
			mtime: overrides?.stat?.mtime ?? 2000,
			size: overrides?.stat?.size ?? 256,
		},
	};
}

function makeVault(): MockVault {
	return {
		getFileByPath: vi.fn(),
		readBinary: vi.fn(),
		createBinary: vi.fn(),
		modifyBinary: vi.fn(),
	};
}

function makeApp(vault?: MockVault): MockApp {
	return {vault: vault ?? makeVault()};
}

function makeReadRequest(overrides?: Partial<CoreReadRequest>): CoreReadRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'file',
		path: 'assets/image.png',
		...overrides,
	};
}

function makeWriteRequest(overrides?: Partial<CoreWriteRequest>): CoreWriteRequest {
	return {
		apiKeyId: 'kado_test-key',
		operation: 'file',
		path: 'assets/image.png',
		content: btoa('binary-content'),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Helper — encode a byte array to base64 (matches what the adapter produces)
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

// ---------------------------------------------------------------------------
// read() — happy path
// ---------------------------------------------------------------------------

describe('createFileAdapter() — read()', () => {
	it('returns a CoreFileResult with base64-encoded content, timestamps, and size', async () => {
		const vault = makeVault();
		const file = makeTFile();
		const rawBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		const buffer = rawBytes.buffer;

		vault.getFileByPath.mockReturnValue(file);
		vault.readBinary.mockResolvedValue(buffer);

		const adapter = createFileAdapter(makeApp(vault) as never);
		const result = await adapter.read(makeReadRequest());

		expect(result.path).toBe('assets/image.png');
		expect(result.content).toBe(bytesToBase64(rawBytes));
		expect(result.created).toBe(1000);
		expect(result.modified).toBe(2000);
		expect(result.size).toBe(256);
	});

	it('passes the request path to vault.getFileByPath', async () => {
		const vault = makeVault();
		const file = makeTFile({path: 'docs/report.pdf'});

		vault.getFileByPath.mockReturnValue(file);
		vault.readBinary.mockResolvedValue(new ArrayBuffer(0));

		const adapter = createFileAdapter(makeApp(vault) as never);
		await adapter.read(makeReadRequest({path: 'docs/report.pdf'}));

		expect(vault.getFileByPath).toHaveBeenCalledWith('docs/report.pdf');
	});

	it('throws a NOT_FOUND error when file does not exist', async () => {
		const vault = makeVault();
		vault.getFileByPath.mockReturnValue(null);

		const adapter = createFileAdapter(makeApp(vault) as never);
		await expect(adapter.read(makeReadRequest())).rejects.toMatchObject({
			code: 'NOT_FOUND',
			message: expect.stringContaining('assets/image.png'),
		});
	});
});

// ---------------------------------------------------------------------------
// write() — create (no expectedModified)
// ---------------------------------------------------------------------------

describe('createFileAdapter() — write() create', () => {
	it('calls vault.createBinary with decoded ArrayBuffer and returns CoreWriteResult', async () => {
		const vault = makeVault();
		const createdFile = makeTFile({stat: {ctime: 3000, mtime: 3000, size: 13}});

		vault.getFileByPath.mockReturnValue(null);
		vault.createBinary.mockResolvedValue(createdFile);

		const base64Content = btoa('hello-binary!');
		const adapter = createFileAdapter(makeApp(vault) as never);
		const result = await adapter.write(makeWriteRequest({content: base64Content}));

		expect(vault.createBinary).toHaveBeenCalledOnce();
		const [calledPath, calledBuffer] = vault.createBinary.mock.calls[0] as [string, ArrayBuffer];
		expect(calledPath).toBe('assets/image.png');
		// Verify the buffer round-trips back to the original base64
		const roundTripped = bytesToBase64(new Uint8Array(calledBuffer));
		expect(roundTripped).toBe(base64Content);

		expect(result).toMatchObject({
			path: 'assets/image.png',
			created: 3000,
			modified: 3000,
		});
	});

	it('throws a CONFLICT error when file already exists during create', async () => {
		const vault = makeVault();
		vault.getFileByPath.mockReturnValue(makeTFile());

		const adapter = createFileAdapter(makeApp(vault) as never);
		await expect(adapter.write(makeWriteRequest({content: btoa('data')}))).rejects.toMatchObject({
			code: 'CONFLICT',
			message: expect.stringContaining('assets/image.png'),
		});
		expect(vault.createBinary).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// write() — update (with expectedModified)
// ---------------------------------------------------------------------------

describe('createFileAdapter() — write() update', () => {
	it('calls vault.modifyBinary when expectedModified is set and returns CoreWriteResult', async () => {
		const vault = makeVault();
		const file = makeTFile({stat: {ctime: 1000, mtime: 2000, size: 256}});

		vault.getFileByPath.mockReturnValue(file);
		vault.modifyBinary.mockResolvedValue(undefined);

		const base64Content = btoa('updated-data');
		const adapter = createFileAdapter(makeApp(vault) as never);
		const result = await adapter.write(
			makeWriteRequest({content: base64Content, expectedModified: 2000}),
		);

		expect(vault.modifyBinary).toHaveBeenCalledOnce();
		const [calledFile, calledBuffer] = vault.modifyBinary.mock.calls[0] as [MockTFile, ArrayBuffer];
		expect(calledFile).toBe(file);
		const roundTripped = bytesToBase64(new Uint8Array(calledBuffer));
		expect(roundTripped).toBe(base64Content);

		expect(result).toMatchObject({
			path: 'assets/image.png',
		});
		expect(vault.createBinary).not.toHaveBeenCalled();
	});

	it('throws a NOT_FOUND error when updating a non-existent file', async () => {
		const vault = makeVault();
		vault.getFileByPath.mockReturnValue(null);

		const adapter = createFileAdapter(makeApp(vault) as never);
		await expect(
			adapter.write(makeWriteRequest({content: btoa('data'), expectedModified: 9999})),
		).rejects.toMatchObject({
			code: 'NOT_FOUND',
			message: expect.stringContaining('assets/image.png'),
		});
		expect(vault.modifyBinary).not.toHaveBeenCalled();
	});
});
