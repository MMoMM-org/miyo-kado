/**
 * HeaderSection — persistent header rendered above the tab row in KadoSettingsTab.
 *
 * Why this file exists: the header surfaces plugin identity (name, version,
 * author, documentation link) sourced directly from manifest.json plus the
 * Kado hanko (印, the seal) as a visual anchor on the right. Manifest-driven
 * so any change to plugin metadata automatically propagates.
 *
 * Layout (two-column flex):
 *   ┌─ .kado-header-text (flex 1) ────────────────────┐  ┌─ .kado-header-hanko ─┐
 *   │ .kado-header-identity                            │  │   <img 72x72>        │
 *   │   Name v0.8.0 · Author · Documentation           │  │                      │
 *   │ .kado-tagline                                    │  │                      │
 *   │   Obsidian MCP Gateway                           │  │                      │
 *   └──────────────────────────────────────────────────┘  └──────────────────────┘
 *
 * Tagline: hardcoded `TAGLINE` constant. We deliberately keep this independent
 * from `manifest.description` — the manifest description is the prose blurb
 * Obsidian shows in its Community Plugins listing (longer, search-friendly),
 * while the in-plugin header tagline is a punchy identity. They serve
 * different audiences.
 *
 * Hanko delivery: imported as a build-time data URI (esbuild `dataurl`
 * loader; Vite returns an asset URL in tests). The PNG is inlined into
 * main.js so the seal renders regardless of installer — the official
 * Community Plugins flow and BRAT both fetch only main.js / manifest.json /
 * styles.css and would skip a sibling `assets/` folder.
 *
 * Funding links: NOT rendered here. Obsidian's Community Plugins UI surfaces
 * `manifest.fundingUrl` automatically on the plugin's listing page, so we
 * don't duplicate it inside our own settings panel.
 */

import type {PluginManifest} from 'obsidian';
import hankoImageUrl from '../../assets/kado_hanko_144.png';

interface HeaderSectionDeps {
	plugin: {manifest: PluginManifest};
}

/** Hardcoded GitHub repository URL — used as the Documentation link. */
const REPO_URL = 'https://github.com/MMoMM-org/miyo-kado';

/** In-plugin header tagline. Curated identity copy, not the verbose manifest
 *  description used by Obsidian's plugin listing. */
const TAGLINE = 'Where AI meets your vault — on your terms';

/**
 * Parses the human-readable author display name from Obsidian's author string.
 * Obsidian convention: "Full Name <email@example.com>" — we take the part
 * before the angle bracket and trim whitespace. Falls back to the full string
 * if no angle bracket is present.
 */
function parseAuthorDisplayName(author: string): string {
	const angleIdx = author.indexOf('<');
	if (angleIdx === -1) return author.trim();
	return author.slice(0, angleIdx).trim();
}

export class HeaderSection {
	private readonly plugin: {manifest: PluginManifest};

	constructor(deps: HeaderSectionDeps) {
		this.plugin = deps.plugin;
	}

	/**
	 * Populates a container with the plugin header.
	 *
	 * @param containerEl — target element to render into; the orchestrator
	 *   (KadoSettingsTab) supplies this so the header lands in the correct
	 *   layout slot.
	 */
	render(containerEl: HTMLElement): void {
		const {manifest} = this.plugin;
		const manifestWithUrl = manifest as PluginManifest & {authorUrl?: string};

		// Left column: text identity
		const textCol = containerEl.createDiv({cls: 'kado-header-text'});

		// Identity line: name vX.Y.Z · Author · Documentation
		const identity = textCol.createDiv({cls: 'kado-header-identity'});

		identity.createSpan({text: manifest.name, cls: 'kado-plugin-name'});
		identity.createSpan({text: ` v${manifest.version}`});

		const authorName = parseAuthorDisplayName(manifest.author ?? '');
		identity.createSpan({text: ' · ', cls: 'kado-header-sep'});
		if (manifestWithUrl.authorUrl !== undefined) {
			identity.createEl('a', {text: authorName, href: manifestWithUrl.authorUrl});
		} else {
			identity.createSpan({text: authorName});
		}

		identity.createSpan({text: ' · ', cls: 'kado-header-sep'});
		identity.createEl('a', {text: 'Documentation', href: REPO_URL});

		// Tagline (curated, manifest-independent)
		textCol.createEl('p', {text: TAGLINE, cls: 'kado-tagline'});

		// Right column: hanko image (build-time inlined data URI)
		containerEl.createEl('img', {
			cls: 'kado-header-hanko',
			attr: {
				src: hankoImageUrl,
				alt: `${manifest.name} hanko`,
			},
		});
	}
}
