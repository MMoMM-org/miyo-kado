import {describe, it, expect, beforeEach} from 'vitest';
import {DEFAULT_SETTINGS, MyPluginSettings} from '../src/settings';

describe('Settings', () => {
	describe('DEFAULT_SETTINGS', () => {
		it('should have a mySetting property with default value', () => {
			expect(DEFAULT_SETTINGS.mySetting).toBe('default');
		});

		it('should satisfy the MyPluginSettings interface', () => {
			const settings: MyPluginSettings = DEFAULT_SETTINGS;
			expect(settings).toBeDefined();
		});
	});
});
