# Decisions — Kado
<!-- Architecture choices and rationale. Updated: 2026-03-30 -->
<!-- What goes here: why we chose X over Y, ADR links, significant tradeoff choices -->
<!-- Format: YYYY-MM-DD — Decision: [what] — Rationale: [why] -->

<!-- 2026-03-30 -->
- 2026-03-30 — Decision: **Vitest over Jest** — Rationale: ESM-native, fast startup, good TypeScript integration without extra transform config. jsdom for DOM environment since plugin uses Obsidian UI APIs
- 2026-03-30 — Decision: **Obsidian API mock via Vitest alias** — Rationale: Obsidian can only be used after consultation; mock allows unit testing without Obsidian runtime. Alias in vitest.config.ts redirects `obsidian` imports to `test/__mocks__/obsidian.ts`
- 2026-03-30 — Decision: **semantic-release (Dynbedded pattern)** — Rationale: Reference repo obsidian-dynbedded uses same approach. Conventional Commits drive automatic versioning, changelog, and GitHub Release with plugin assets. No npm publish needed
- 2026-03-30 — Decision: **Build output to `build/` for releases** — Rationale: Separates dev output (root `main.js` for hot-reload) from release artifacts (build/ dir with all assets for GitHub Release upload)
- 2026-04-20 — Decision: **`kado-open-notes` two-layer gate: feature-flag AND path-ACL, no inheritance** — Rationale: Spec 006. Per-key `allowActiveNote`/`allowOtherNotes` AND-combine with global (no inheritance). Feature-gate denial returns FORBIDDEN with explicit reason; path-ACL denial is silent (no note-existence leak). Default OFF everywhere. See `docs/XDD/specs/006-open-notes-tool/solution.md` for ADRs 1–6
- 2026-05-09 — Decision: **`resolveScope` picks the most specific matching pattern, not the first-declared** — Rationale: First-match-wins made vault-wide patterns like `**` (default-deny / read-only fallback) silently shadow narrower exceptions like `X/900 Support/**`, even when the narrow rule was declared explicitly. Specificity score = count of literal (non-`*`/`?`) characters in the pattern; declaration order is the deterministic tie-breaker. Applies in both whitelist and blacklist modes (global security AND per-key scope). Implementation: `src/core/gates/scope-resolver.ts`
