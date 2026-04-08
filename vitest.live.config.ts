/**
 * Vitest config for live integration tests against a running Kado MCP server.
 *
 * Separate from the main config because live tests:
 *   - Need 'node' environment (real network, no jsdom)
 *   - Don't mock Obsidian (they talk to the real instance)
 *   - Need longer timeouts (network round-trips)
 *
 * Run via: npm run test:live
 */

import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['test/live/**/*.test.ts'],
		testTimeout: 90_000,
		hookTimeout: 30_000,
	},
});
