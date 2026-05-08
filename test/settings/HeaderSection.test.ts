/**
 * HeaderSection — verifies the hanko ships inlined (no runtime asset
 * resolution required), so installs via BRAT or manual zip — neither of
 * which extract the `assets/` directory — still render the seal.
 */

import {describe, it, expect} from 'vitest';
import type {PluginManifest} from 'obsidian';
import {augmentEl} from '../__mocks__/obsidian';
import {HeaderSection} from '../../src/settings/HeaderSection';

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
	return {
		id: 'miyo-kado',
		name: 'Kado',
		version: '0.0.0-test',
		minAppVersion: '1.5.7',
		description: 'test',
		author: 'Marcus Breiden <marcus@breiden.net>',
		...overrides,
	} as PluginManifest;
}

describe('HeaderSection', () => {
	it('renders the hanko image without a runtime asset resolver', () => {
		const section = new HeaderSection({plugin: {manifest: makeManifest()}});
		const container = augmentEl(document.createElement('div'));

		section.render(container);

		const img = container.querySelector<HTMLImageElement>('img.kado-header-hanko');
		expect(img).not.toBeNull();
		expect(img?.getAttribute('src') ?? '').not.toBe('');
		expect(img?.getAttribute('alt')).toBe('Kado hanko');
	});

	it('renders the manifest-driven identity line', () => {
		const section = new HeaderSection({plugin: {manifest: makeManifest({version: '1.2.3'})}});
		const container = augmentEl(document.createElement('div'));

		section.render(container);

		const text = container.textContent ?? '';
		expect(text).toContain('Kado v1.2.3');
		expect(text).toContain('Marcus Breiden');
		expect(text).toContain('Documentation');
	});
});
