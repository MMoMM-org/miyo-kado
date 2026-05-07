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
 * Funding links: NOT rendered here. Obsidian's Community Plugins UI surfaces
 * `manifest.fundingUrl` automatically on the plugin's listing page, so we
 * don't duplicate it inside our own settings panel.
 */

import type {PluginManifest} from 'obsidian';

interface HeaderSectionDeps {
	plugin: {manifest: PluginManifest};
	/**
	 * Resolves a plugin-relative asset path (e.g. "assets/MiYo-Kado.png")
	 * to a URL the browser can load. Production wires this to
	 * `app.vault.adapter.getResourcePath(`${manifest.dir}/${rel}`)`. Tests
	 * inject a stub. When absent, the hanko image is skipped — the text
	 * column still renders.
	 */
	resolveAsset?: (relativePath: string) => string;
}

/** Hardcoded GitHub repository URL — used as the Documentation link. */
const REPO_URL = 'https://github.com/MMoMM-org/miyo-kado';

/** Plugin-relative path to the hanko image. The asset is pre-scaled to
 *  144×144 (2× HiDPI source), rendered natively at 72×72 by CSS so the
 *  shipped binary stays under ~30 KB. */
const HANKO_REL_PATH = 'assets/kado_hanko_144.png';

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
	private readonly resolveAsset: ((rel: string) => string) | undefined;

	constructor(deps: HeaderSectionDeps) {
		this.plugin = deps.plugin;
		this.resolveAsset = deps.resolveAsset;
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

		// Right column: hanko image (only when resolveAsset is wired)
		if (this.resolveAsset !== undefined) {
			const src = this.resolveAsset(HANKO_REL_PATH);
			containerEl.createEl('img', {
				cls: 'kado-header-hanko',
				attr: {
					src,
					alt: `${manifest.name} hanko`,
				},
			});
		}
	}
}
