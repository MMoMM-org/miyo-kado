# Phase 5 — M18 Settings UI Component Tests

**Spec refs:** PRD Feature 3, SDD §2.5

## Tasks

1. **Extend Obsidian mock** in `test/__mocks__/obsidian.ts`
   - `TextComponent`: expose `inputEl: HTMLInputElement`, wire input events to `onChange`
   - `ButtonComponent`: expose `buttonEl: HTMLButtonElement`, wire click to `onClick`
   - `ToggleComponent`: expose `toggleEl`, wire `setValue`/`onChange`
   - `DropdownComponent`: expose `selectEl: HTMLSelectElement`, wire change
   - `Modal`: ensure `open()`/`close()` invoke `onOpen()`/`onClose()`, `contentEl` is real
   - Keep existing tests passing (additive only)

2. **Shared test helpers** in `test/settings/helpers.ts`
   - `renderInSandbox<T>(fn)` — creates detached `HTMLElement`, runs render fn, returns result
   - `mockPlugin(overrides?)` — builds a `KadoPlugin` instance with mocked config + `saveSettings` spy
   - `clickDot`, `typeInto`, `fireSelect` — small event simulators

3. **Component tests** — one file per component, behavioral assertions:

| File | Target |
|------|--------|
| `test/settings/components/PermissionMatrix.test.ts` | dot click toggles, disabled no-op, keyboard, onChange calls |
| `test/settings/components/PathEntry.test.ts` | input mutation, invalid path blocked, remove fires, browse opens modal |
| `test/settings/components/TagEntry.test.ts` | input `#`-normalization, remove fires, picker interaction |
| `test/settings/components/TagPickerModal.test.ts` | filtered list, select calls onSelect, close after select |
| `test/settings/components/VaultFolderModal.test.ts` | folder list from mock vault, filter, select |
| `test/settings/tabs/ApiKeyTab.test.ts` | generate-key, rename, delete, saveSettings exactly-once |
| `test/settings/tabs/GeneralTab.test.ts` | server toggle, port input, audit toggle, save called |
| `test/settings/tabs/GlobalSecurityTab.test.ts` | add/remove path, list-mode toggle warning, save called |

4. **Coverage** — enable vitest coverage for `src/settings/**`, verify ≥80%

5. **Fix any gaps** — if coverage falls short, add missing assertions

## Files touched

- `test/__mocks__/obsidian.ts` (additive extensions)
- `test/settings/helpers.ts` (new)
- `test/settings/components/*.test.ts` (5 new files)
- `test/settings/tabs/*.test.ts` (3 new files)

## Acceptance

- PRD Feature 3 acceptance criteria pass
- `src/settings/**` line coverage ≥ 80%
- All previously-passing tests still pass
- `npm test`, `npm run lint`, `npm run build` green

## Commit

`test(settings): behavioral tests for 8 UI components (M18)`
