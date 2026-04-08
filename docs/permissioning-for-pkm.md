# Permissioning your AI: from guardrails to enforcement

A reference for PKM practitioners who give AI access to their vaults.

---

## Why this matters

Your vault is the most valuable single thing you will ever feed an AI. It is not just text — it is connections, context, and the shape of how you think. Once an AI can read it, it can read all of it. Once it can write to it, it can rewrite all of it.

Most PKM/AI integrations gloss over this. They assume that if the AI is "your" AI, it should have access to "your" stuff. But "your stuff" includes:

- Journal entries with names and details about real people in your life
- Drafts you abandoned and never want to revisit
- Half-formed ideas that would embarrass you out of context
- Client notes covered by NDA
- Tax records, health notes, financial planning
- Correspondence with your therapist
- That one folder you barely admit exists

Giving an AI uncontrolled read access to all of that is the digital equivalent of handing someone your unlocked phone "just to look something up". Fine — until it isn't.

This appendix gives you a framework for thinking about the problem and implementing real access control over your AI workflows.

---

## Guardrails vs permissions: the central distinction

Most AI integrations rely on **guardrails**, not permissions. The two look similar from the outside but behave very differently when something goes wrong.

A **guardrail** asks the AI to behave. Examples:

- A `CLAUDE.md` file that says "do not read anything in `private/`"
- A system prompt that says "you are a research assistant; only answer questions about my notes on AI and physics"
- A filesystem sandbox that contains the AI process inside `~/Documents/notes/`
- A tool description that says "use this only for read operations"

These work most of the time. They are what they sound like — rails that nudge the AI toward correct behavior. They are not enforcement.

A **permission** denies the request before the AI ever sees the data. Examples:

- A gateway that returns `403 Forbidden` when the AI asks to read `private/diary.md`, regardless of how the AI was prompted
- A token with read-only scope that physically cannot perform a write operation
- A path filter at the data layer that removes files from search results before they reach the model

The difference matters because:

1. **Guardrails depend on the model behaving.** Models are non-deterministic. They follow instructions until they don't. Prompt injection in your own notes can flip them. A new model version may interpret the same instruction differently.
2. **Guardrails have no audit trail.** When a guardrail is bypassed, you usually don't know it happened. When a permission is enforced, you can log the denied request.
3. **Guardrails can't distinguish between agents.** A `CLAUDE.md` rule applies to whatever AI reads it. A token-based permission applies to a specific identity you can name and revoke.
4. **Guardrails don't survive copy-paste.** If an AI sees a path in one conversation, that path is in the conversation history forever, available to whatever model you paste it into next.

Use guardrails. They are useful. But do not call them permissioning.

---

## The three layers, properly named

When PKM tools talk about "AI access control" they usually mean one of these three things. They are not interchangeable.

| Layer            | What it does                                                                            | What it does not do                                                |
| ---------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Instructions** | Tells the AI what it should and shouldn't do via prompts, `CLAUDE.md`, system messages | Stops the AI when it ignores the instructions                      |
| **Sandbox**      | Limits what the AI *process* can touch on disk (Claude Code sandbox, Docker, etc.)      | Helps once that process is talking to another tool with own access |
| **Permissions**  | Denies forbidden requests at the data layer, regardless of who asks                     | Anything you didn't configure                                      |

A robust setup uses all three, with permissions as the foundation and the other two as defense-in-depth.

---

## What "real permissioning" requires

If you want actual permissions on top of your vault, the implementation needs at least these properties:

### 1. Default-deny

Nothing is accessible until you explicitly say it is. The opposite — default-allow with a list of exceptions — fails the first time you create a sensitive file and forget to update the exception list.

### 2. Per-identity scope

Each AI assistant or workflow gets its own identity (an API key, a token, a credential). Different identities can have different scopes. You can revoke one without affecting the others.

If you have one AI for "general research" and another for "personal journaling assistance", they should be different identities with different scopes — even if they are the same model under the hood.

### 3. Granular scope per identity

Per identity, you should be able to express:

- **Which paths** are accessible (allow `projects/active/**`, deny everything else)
- **Which data types** are accessible (note bodies? frontmatter? attachments? raw files?)
- **Which operations** are allowed (read? create? update? delete?)
- **Which tags or metadata filters** apply

Read-only access to a folder is a different scope from read+write access to the same folder. Treat them differently.

### 4. Enforcement at the data layer

When the AI requests a forbidden resource, the answer is "denied" returned by the data layer — not "the AI politely declines because we asked it to". If you remove the AI and call the data layer directly with the same credentials, you should still get denied.

### 5. Audit log

Every allowed and denied request is recorded with: timestamp, identity, what was requested, what was returned. You should be able to look at this log a week later and answer "what did this AI actually touch last Thursday afternoon?"

The log should record metadata only — never the file contents themselves. Otherwise the audit log itself becomes a security hole.

### 6. Easy revocation

Revoking an identity should take seconds, not require a redesign. If you stop trusting a particular tool, you should be able to disable its credential without breaking the rest of your setup.

---

## Common pitfalls

A few patterns that look like permissioning but aren't:

**"I'll just put sensitive notes in a separate vault."** Works until you want the AI to see *some* of your notes from both. Doesn't survive the first time you copy a note across vaults.

**"My CLAUDE.md tells the AI not to read X."** Guardrail, not permission. See above.

**"I put strict rules in the AI's own configuration file."** The AI can usually read and edit its own configuration file. If your guardrails live in a file the AI itself can rewrite — `CLAUDE.md`, `settings.json`, hook scripts, system prompt files — they are suggestions it is making to itself. Real permissions live in a separate, unprivileged component the AI cannot modify.

**"I run the AI in a Docker container, so it's safe."** A sandbox limits what the AI *process* can touch directly. It does not limit what the AI can ask *another tool* (an MCP server, an API plugin, an HTTP endpoint) to fetch on its behalf. That tool is outside the sandbox.

**"I use a tool with a read-only toggle in its UI."** Verify the toggle is enforced on the server side, not just hidden in the UI. A "read-only" switch that removes the write button but leaves the write endpoint open is not permissioning.

**"I trust the AI not to do anything weird."** Trust is fine for low-stakes work. For your full vault, trust is not a security model.

---

## A starter checklist

When you set up an AI integration with your vault, walk through these:

- [ ] Do I have a written list of what this AI is allowed to access?
- [ ] Is the rest of my vault default-deny for this AI?
- [ ] Does this AI have its own identity, separate from any other AI integration?
- [ ] Can I revoke this identity in under a minute?
- [ ] If I remove the AI and call the same access path manually with this identity, am I still bound by the same restrictions?
- [ ] Is there a log somewhere that shows me what this AI requested?
- [ ] Have I tried denying a request to make sure the denial actually works?
- [ ] If I add a new sensitive folder tomorrow, will it be protected by default?

If you can tick all eight, you have permissioning. If you can tick fewer than four, you have guardrails dressed up as permissioning.

---

## Implementation options

There are several ways to build this for an Obsidian-based PKM workflow. None of them are perfect; pick the one that fits your comfort level and the AI tools you use.

**1. Vault-side gateway (recommended for most PKM users).** Run a small server inside Obsidian that exposes a permissioned interface to the vault. AI tools connect to the gateway via the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP). The gateway holds the access rules and enforces them at the data layer.

A reference implementation for this pattern is **MiYo Kado**, a free, MIT-licensed Obsidian community plugin. It is a default-deny, per-key, audited MCP server that runs inside your vault. It implements every property described in this appendix. It is not the only option, but it is the one I know best because I wrote it. Repository: <https://github.com/MMoMM-org/miyo-kado>.

**2. Obsidian's Local REST API plugin + your own proxy.** If you are comfortable writing a small proxy, you can put one in front of the existing REST API plugin and enforce policies there. More work, more flexibility, fewer guardrails out of the box.

**3. A separate filtered vault.** Maintain a "shareable" vault that contains only what the AI is allowed to see, synced from your main vault by a script that respects an allow-list. Lower-tech, works well for read-only workflows where the AI never needs to write back.

**4. Direct file access via a sandboxed tool.** Use a tool like Claude Code with a strict filesystem sandbox covering only the files you allow. This is closer to real permissioning than a `CLAUDE.md` rule, but the sandbox has several failure modes worth understanding before you rely on it:

- **The sandbox can be opened from inside.** Claude Code prompts the user for permission every time the AI wants to read or write outside the allowed paths. That prompt fires even in auto-accept mode, and users in the flow of a session will click through it almost reflexively. Once granted, the exception holds for the rest of that session.
- **Scoping the tool to one directory is not isolation.** Pointing an agent at `~/notes/` does not prevent it from *asking* to read `~/.ssh/config`. Scoping prevents unsolicited access; it does not prevent requested access. If the user can grant an exception at runtime, the scope is a default, not a boundary.
- **The agent can rewrite its own guardrails.** Claude Code can read and edit its own `CLAUDE.md`, `settings.json`, and hook scripts — the exact files that encode the rules it runs under. In normal mode it does this without asking. In sandbox mode the edit itself requires a permission prompt, which circles back to the first point: users click through. An AI that can change its own rules has no stable guardrails, only advisory ones.
- **Anything the tool calls out to is back to guardrail level.** The filesystem sandbox only constrains direct disk access. If Claude Code calls an MCP server, an HTTP API, or another plugin, that second-hop access is entirely outside the sandbox's scope. A sandboxed Claude Code talking to an un-permissioned MCP server has the same view of the data that the MCP server exposes — the sandbox does not help there.

Option 4 is reasonable when your threat model is "reduce accidental mistakes during attentive sessions" and you trust yourself not to click through escape prompts. It is inadequate when your threat model includes prompt injection, unattended sessions, or auditability.

Whichever route you pick, walk it through the starter checklist above before you trust it with your real work.

---

## A note on threat models

Permissioning is not about assuming your AI is malicious. The threat model is broader and quieter:

- **Accidental over-collection.** The AI was asked a question and pulled 200 files for context. Some of them shouldn't have been pulled. You will not know which ones unless you have an audit log.
- **Prompt injection from your own notes.** A note you saved a year ago contains a sentence that, today, an AI reads as an instruction. Without enforcement, the AI follows it.
- **Context leakage between conversations.** Information from one chat surfaces in another, or in a model the original tool never intended to share with.
- **A future AI tool you will connect to that does not yet exist.** Your permissioning needs to work for that one too — which is why per-identity revocation matters.

You do not need to be paranoid. You need to be precise about what you have allowed and have a way to verify it.

---

## Further reading

- [Model Context Protocol specification](https://modelcontextprotocol.io/) — the protocol most "AI talks to tools" integrations are converging on
- [Obsidian Developer Policies](https://docs.obsidian.md/Developer+policies) — what plugins are and aren't allowed to do with vault data
- [MiYo Kado repository](https://github.com/MMoMM-org/miyo-kado) — reference implementation of the patterns described above
