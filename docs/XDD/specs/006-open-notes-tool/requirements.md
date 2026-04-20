---
title: "Open Notes Tool"
status: draft
version: "1.0"
---

# Product Requirements Document

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All required sections are complete
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Problem statement is specific and measurable
- [x] Every feature has testable acceptance criteria (Gherkin format)
- [x] No contradictions between sections

### QUALITY CHECKS (Should Pass)

- [x] Problem is validated by evidence (not assumptions)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking events
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Product Overview

### Vision
Expose the user's currently open Obsidian notes to MCP clients through a single, consent-gated tool so assistants can ground their work in "what the user is looking at right now" without manual copy-paste.

### Problem Statement
MCP clients integrated with Kado (e.g., Claude Desktop, Claude Code) can read, write, search, and delete notes by path — but they have no way to discover *which* notes the user currently has open in Obsidian. Assistants working on "my current note" or "the notes I'm comparing" must ask the user to paste paths verbatim, which breaks flow and is error-prone. At the same time, exposing open-note state is a privacy-sensitive signal: the user's live focus should never leak to an API key that the user has not explicitly authorized for this capability.

Today this forces users into one of two bad outcomes:
- Copy-paste note paths into every prompt (friction, typos, stale references).
- Grant overly broad path permissions so the assistant can guess from search results (leaks unrelated notes).

### Value Proposition
A single opt-in MCP tool (`kado-open-notes`) that returns open-note metadata as JSON, double-gated by (1) explicit per-key feature flags and (2) the existing path ACL. Users who want it can flip a toggle; users who don't get zero change in exposure. Default is off everywhere, and opt-in is required per API key — no inheritance from global settings. This is consistent with Kado's "least-privilege by default" philosophy.

## User Personas

### Primary Persona: Obsidian-native Knowledge Worker
- **Demographics:** Age 25–55, technical or semi-technical (developer, researcher, writer, consultant), daily Obsidian user, uses an MCP-aware AI client alongside Obsidian.
- **Goals:** Ask the assistant questions about "this note" or "the two notes I have open" without retyping paths. Keep the AI grounded in live context.
- **Pain Points:** Currently must paste paths or full note contents into every prompt; loses context when switching between notes; worries about over-sharing if they widen path permissions.

### Secondary Persona: Plugin Integrator / Power User
- **Demographics:** Technical user who configures API keys for specific downstream tools (a personal agent, a custom MCP client, a teammate's tool). Comfortable editing per-key permissions.
- **Goals:** Grant narrowly-scoped capabilities per key. Wants to allow open-note discovery for a trusted key but not for a general-purpose key.
- **Pain Points:** Without a dedicated gate, any exposure of open-note state applies to all keys, which is too coarse.

## User Journey Maps

### Primary User Journey: "Ask about my current note"
1. **Awareness:** User has Kado installed, uses Claude Desktop as MCP client, and wants to ask about a note they just opened.
2. **Consideration:** User realizes they'd have to copy the full path into the chat; reads the Kado settings for a less friction-heavy option.
3. **Adoption:** User opens Kado → Key Settings → Open Notes section, toggles "Active note" on for their trusted key.
4. **Usage:** User opens a note in Obsidian, asks the assistant "summarize my current note". The client calls `kado-open-notes` (scope: `active`), receives `{ name, path, active: true, type: "markdown" }`, then calls `kado-read` with the path.
5. **Retention:** Friction drops to zero for the common "current note" case. User also enables "Other open notes" later when doing multi-note comparison work.

### Secondary User Journey: "Scoped key for a trusted agent"
1. User runs a personal agent that compares the two notes they have open side-by-side.
2. User creates a dedicated API key, grants R access on the vault's relevant folders, and in the key's Open Notes section enables both `Active note` and `Other open notes`.
3. Agent calls `kado-open-notes` with `scope: all`, gets both open notes filtered by the key's path ACL, and proceeds.
4. Other API keys remain unaffected — they cannot discover open-note state because their toggles are still off.

## Feature Requirements

### Must Have Features

#### Feature 1: `kado-open-notes` MCP Tool
- **User Story:** As an MCP client, I want to query the user's currently open notes so that I can ground my responses in live context without asking the user to paste paths.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the tool is called with `scope: "active"`, When the key has `allowActiveNote: true` and the focused leaf shows a file the key has R permission on, Then the response contains a single entry with `active: true`, the note name, path, and type
  - [ ] Given the tool is called with `scope: "other"`, When the key has `allowOtherNotes: true`, Then the response contains every non-active open file the key has R permission on, each with `active: false`
  - [ ] Given the tool is called with `scope: "all"`, When both gates are on, Then the response contains active + other, with exactly one `active: true` entry (or zero if no leaf is focused on a file)
  - [ ] Given the tool is called with no `scope` parameter, When the tool resolves, Then it behaves as if `scope: "all"` was passed
  - [ ] Given the tool is called, When no file is currently open or none survive filtering, Then the response is `{ notes: [] }` with no error
  - [ ] Given the tool response, When inspected, Then each note entry contains exactly the keys `name`, `path`, `active`, `type`

#### Feature 2: Feature Gate — Per-Key Toggles with No Inheritance
- **User Story:** As a Kado user, I want to enable open-note exposure only for specific API keys so that most keys stay minimally privileged.
- **Acceptance Criteria:**
  - [ ] Given an API key is newly created, When its config is loaded, Then both `allowActiveNote` and `allowOtherNotes` default to `false`
  - [ ] Given the global `allowActiveNote` is set to `true`, When a key has `allowActiveNote: false`, Then the key is still denied active-note access (no inheritance)
  - [ ] Given the global `allowActiveNote` is set to `false`, When a key has `allowActiveNote: true`, Then the key is still denied active-note access (both gates must pass)
  - [ ] Given both global `allowOtherNotes` and key `allowOtherNotes` are `true`, When `kado-open-notes` is called with `scope: "other"`, Then the category is exposed (subject to path ACL)

#### Feature 3: Error Semantics — `not_allowed` vs Silent Filter
- **User Story:** As an MCP client, I want a clear error when the user has disabled the capability, but I want the tool to silently omit notes I am not permitted to see, so that I cannot probe for note existence.
- **Acceptance Criteria:**
  - [ ] Given `scope: "active"` is requested, When either the global or key `allowActiveNote` is `false`, Then the tool returns a `FORBIDDEN` error with gate identifier `feature-gate` and a message explaining which scope is disabled
  - [ ] Given `scope: "all"` is requested, When one gate is off but the other is on, Then the tool silently omits the disabled category and returns the remaining notes with no error
  - [ ] Given `scope: "all"` is requested, When both gates are off, Then the tool returns `FORBIDDEN` with gate `feature-gate`
  - [ ] Given any scope is requested and the gate(s) pass, When a candidate note's path fails the key's path ACL, Then that note is silently omitted from the response (no per-note error leaks existence)
  - [ ] Given any scope is requested and all candidate notes are path-ACL-filtered, When the response is built, Then it is `{ notes: [] }` with no error

#### Feature 4: Settings UI — Open Notes Section
- **User Story:** As a Kado user, I want to enable or disable open-note exposure in the settings UI so that I can manage consent without editing config files.
- **Acceptance Criteria:**
  - [ ] Given the GlobalSecurityTab is rendered, When the user scrolls to the Permissions area, Then an "Open Notes" section appears between Access Mode and Paths
  - [ ] Given the ApiKeyTab is rendered for any key, When the user scrolls to the Permissions area, Then an "Open Notes" section appears between Access Mode and Paths
  - [ ] Given the Open Notes section, When the user views it, Then two toggles are visible: "Active note" and "Other open notes"
  - [ ] Given the Access Mode toggle is in `whitelist` mode, When the Open Notes toggles are rendered, Then their descriptions use inclusive wording (e.g., "Expose active note to this key")
  - [ ] Given the Access Mode toggle is in `blacklist` mode, When the Open Notes toggles are rendered, Then their descriptions use exclusive wording (e.g., "Do not hide active note from this key")
  - [ ] Given a toggle is flipped, When the change is saved, Then the config persists and subsequent tool calls reflect the new state without a plugin restart

### Should Have Features

#### Feature 5: File-Type Metadata in Response
- **User Story:** As an MCP client, I want to know what kind of file each open note is so that I can choose the right follow-up action.
- **Acceptance Criteria:**
  - [ ] Given an open note is returned, When `type` is inspected, Then it contains a lowercased type identifier (`markdown`, `canvas`, `pdf`, `image`, or the Obsidian view type for unknown types)
  - [ ] Given a non-file view is open (settings pane, graph view, search results), When the tool resolves, Then it is not included in the response

### Could Have Features

#### Feature 6: Leaf-Change Subscription (Future)
- A push / subscription API so clients can react to the user switching notes. **Not in scope for this phase** — clients may poll.

#### Feature 7: Recently-Closed Notes (Future)
- Return the last N recently-closed notes alongside currently-open ones. **Not in scope for this phase.**

### Won't Have (This Phase)

- Write or delete on open notes via this tool (use existing `kado-write` / `kado-delete`)
- Leaf-change push notifications / subscriptions
- Recently-closed / recently-viewed notes
- Enumerating pinned but not currently visible notes differently from other open notes
- Cross-vault or multi-workspace support (single Obsidian vault only)
- Any capability that modifies, opens, or closes a leaf

## Detailed Feature Specifications

### Feature: `kado-open-notes` MCP Tool
**Description:** A single MCP tool that, when called, enumerates the user's currently open Obsidian files, applies the two-layer permission check (feature gate + path ACL), and returns JSON describing the permitted subset. The tool is read-only and does not modify workspace state.

**User Flow:**
1. User enables one or both gates for a specific API key in the settings UI.
2. MCP client calls `kado-open-notes` with optional `scope` parameter (default `all`).
3. Kado applies the feature gate: if the requested scope's gate is off, return `FORBIDDEN`. If `scope: all` and at least one gate is on, proceed with only the permitted category.
4. Kado enumerates open leaves via the Obsidian workspace API and identifies the active (focused) leaf.
5. Kado filters non-file views and applies the path ACL to remaining files (silent drop on deny).
6. Kado constructs the response: `{ notes: [{ name, path, active, type }, ...] }`.

**Business Rules:**
- Rule 1: Both the global gate and the per-key gate for a scope must be `true` for that scope to be exposed. Neither inherits from the other.
- Rule 2: `active` is defined as the single leaf currently holding editor focus, as reported by Obsidian's workspace API. If no leaf is focused on a file, no entry has `active: true`.
- Rule 3: The path ACL applied to each candidate note is exactly the one used by other MCP tools (`kado-read`, `kado-search`): both the global `security.listMode`/paths AND the key's `listMode`/paths must admit the path. `allowActiveNote` / `allowOtherNotes` do not replace the path ACL — they compose with it.
- Rule 4: Path ACL denial on a note is silent — the note is omitted from the response with no per-note error, preventing existence leaks.
- Rule 5: Feature-gate denial is NOT silent when the scope is explicitly requested — it returns `FORBIDDEN` with a message indicating which gate(s) are off.
- Rule 6: When `scope: all` is requested and one gate is off, the tool silently filters that category and returns the other (no error, even partial).

**Edge Cases:**
- No notes open at all → `{ notes: [] }`, no error.
- Active leaf is a non-file view (e.g., settings pane) → no `active: true` entry; other open notes are still returned if permitted.
- Multiple editor panes showing the same file (linked panes) → the file appears at most once in the response; `active: true` reflects which pane has focus.
- Both gates off, `scope: all` requested → `FORBIDDEN`.
- Gate on but all open notes fail path ACL → `{ notes: [] }`, no error (no existence leak).
- Obsidian reports an unknown view type → entry is still returned with `type` set to the raw view type string.

## Success Metrics

### Key Performance Indicators

- **Adoption:** Share of configured API keys with at least one Open Notes toggle enabled (target: observable but low — this is an opt-in advanced feature, not a default experience).
- **Engagement:** Calls per user per day to `kado-open-notes` among keys that have opted in (target: trending upward week-over-week as assistants wire up the capability).
- **Quality:** Ratio of `FORBIDDEN` responses from `feature-gate` to total calls (low ratio indicates clients learned the gates; high ratio may indicate a UX mismatch).
- **Business Impact:** Reduction in user-reported "assistant needed me to paste the path" friction (qualitative, via feedback and issues).

### Tracking Requirements

| Event | Properties | Purpose |
|-------|------------|---------|
| `kado-open-notes.called` | `scope`, `keyId` (hashed) | Measure adoption and scope distribution |
| `kado-open-notes.forbidden` | `scope`, `gateReason` (which gate failed) | Detect gate/UX mismatch |
| `kado-open-notes.result_size` | `count`, `filteredOutCount` | Observe path-ACL filter activity |
| `openNotes.toggle.changed` | `scope` (active/other), `level` (global/key), `newValue` | Understand user consent changes |

*Tracking is subject to the existing audit-log configuration; no new telemetry backend is introduced.*

---

## Constraints and Assumptions

### Constraints
- Must integrate with the existing MCP tool framework (`src/mcp/tools.ts` registration pattern).
- Must reuse the existing permission check (`scope-resolver`, `filterResultsByScope`) — cannot introduce a parallel ACL path.
- Must not require a schema version bump; must migrate silently via default-merge in `config-manager`.
- Obsidian plugin API only — no external services, no network calls.
- Desktop and mobile Obsidian both supported where Obsidian's workspace API is available.

### Assumptions
- Users who want this will discover it in the Kado settings UI; a changelog entry is sufficient announcement.
- MCP clients will poll (e.g., before each prompt that mentions "this note") rather than subscribe — acceptable because the call is cheap and local.
- The `activeLeaf` concept reliably maps to "the note the user is currently editing or viewing" in the user's mental model, including on mobile.
- Pinned / linked panes are rare enough that treating each underlying file once (with `active` reflecting the focused pane) is acceptable.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Path-ACL leak via per-note error messages | High (privacy) | Low (design explicitly forbids) | Enforce silent filter in code review; add test that verifies no note-existence information leaks on ACL denial |
| User surprise — "why does the assistant know my open note?" | Medium (trust) | Low (default off + opt-in per key) | Default-off invariant, clear UI copy, changelog entry |
| Gate/inheritance confusion ("I enabled globally, why doesn't it work?") | Low (support load) | Medium | Settings UI copy states "Global + key must both allow"; docs include explicit example |
| Obsidian API differences between desktop and mobile for `activeLeaf` | Medium (bugs) | Low-Medium | Test on both platforms during live-testing (see `docs/live-testing.md`); fall back to omitting `active: true` if API returns no focused leaf |
| Clients abuse as a polling heartbeat | Low (perf) | Low | Tool is cheap and read-only; no explicit rate limit but the audit log captures call volume for diagnosis |

## Open Questions

None remaining. All design decisions are settled:
- Per-key default OFF, no inheritance from global (confirmed)
- `active` = focused leaf (confirmed)
- `type` field included (confirmed)
- Wording flips with whitelist/blacklist, default does NOT flip (confirmed)

---

## Supporting Research

### Competitive Analysis
The MCP ecosystem is still early. Comparable capabilities exist in IDE-integrated assistants (e.g., Cursor, Claude Code) that expose "open buffers" — all are opt-in, require explicit workspace trust, and return metadata (not contents) as the discovery step, delegating content reads to separate operations. The `kado-open-notes` design follows this established pattern: metadata-only discovery, content retrieval via existing `kado-read`.

### User Research
Informal: the feature originated from the plugin author's own workflow friction (asking assistants about "the note I have open" while building Kado). No formal user study was run. The design bias is therefore conservative — default off, double-gated, silent path filter — to prevent exposure unless the user explicitly opts in.

### Market Data
Obsidian has over 2M users; the MCP ecosystem is growing rapidly (Anthropic, multiple community plugins). The addressable audience within Kado's user base is small but highly engaged — these are users who already run MCP clients and configure API keys. Exact sizing is out of scope for this internal plugin feature.
