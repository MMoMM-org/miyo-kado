# CONSTITUTION.md

## Project Governance Rules

```yaml
rules:
  # SECURITY
  - level: L1
    category: Security
    statement: "MiYo Kado must treat all Obsidian vault content as potentially highly sensitive (e.g., personal, medical, client, financial, IP) and default to denying MCP access to all files and folders unless they are explicitly whitelisted by the user."
    rationale: "Users may store any kind of sensitive data in their PKM; a default-deny stance ensures that nothing is exposed to external AI by accident."

  - level: L1
    category: Security
    statement: "MiYo Kado must enforce a two-layer access control model: (1) a user-configurable blacklist/whitelist that determines which paths are eligible for MCP access, and (2) API-key–scoped permissions that define allowed operations (CRUD and additional capabilities) on those eligible paths."
    rationale: "Separating path eligibility from operation permissions allows users to both fence off parts of their vault and limit what an external AI can do even where access is allowed."

  - level: L1
    category: Security
    statement: "Every MCP request that touches the filesystem must be authorized against both layers of access control (path-level allow/deny and API-key–scoped CRUD rights) before any file read, write, update, or delete occurs."
    rationale: "Ensuring both checks run on every request prevents misconfiguration in one layer from bypassing the other and limits damage from a compromised or overly broad API key."

  - level: L1
    category: Security
    statement: "MiYo Kado must perform security checks (path allow/deny and API-key–scoped permissions) before enqueuing or executing any MCP request; unauthorized requests must fail fast without entering any execution queue."
    rationale: "Failing fast on unauthorized requests avoids wasting resources on work that should not run and reduces the risk of side effects from misconfigured or malicious calls."

  - level: L2
    category: Security
    statement: "MiYo Kado configuration, including blacklists, whitelists, and API-key scopes, may be stored locally in non-versioned, cleartext files within the Obsidian vault or its configuration directory, but code must assume that operating-system–level protections (user accounts, disk encryption) are the primary defense for those secrets."
    rationale: "Obsidian vaults are local and not exposed directly to the network, so cleartext configuration is acceptable, but only if the system itself is treated as the security boundary."

  - level: L2
    category: Security
    statement: "MiYo Kado must provide an audit log of MCP access decisions and file operations, and the user may disable this logging; when logging is enabled, logs must not include full sensitive content, only metadata (e.g., paths, operations, timestamps)."
    rationale: "Auditing access patterns helps users detect misconfigurations or unexpected AI behavior while still allowing privacy-conscious users to opt out and avoiding unnecessary duplication of sensitive content in logs."

  - level: L2
    category: Security
    statement: "MiYo Tomo and any other external AI integrations must not extend their effective access beyond what MiYo Kado’s access control layers allow; any attempt to bypass Kado’s checks (e.g., direct filesystem or vault access) must be rejected in code review."
    rationale: "All file access must flow through the double access control layer so that users can trust that whitelists/blacklists and API-key scopes are the single source of truth for what AI can see and do."

  - level: L3
    category: Security
    statement: "For users who know that certain data categories (e.g., health data, legal client notes) must never leave the local machine, project documentation should recommend maintaining dedicated, permanently blacklisted folders for those categories."
    rationale: "Explicitly recommending structural separation in the vault helps privacy-conscious users keep especially sensitive information outside any possible AI access, even if they misconfigure other rules."

  # ARCHITECTURE
  - level: L1
    category: Architecture
    statement: "MiYo must be developed as a multi-repo system where each major component (e.g., MiYo Kado, MiYo Tomo, future integrations) lives in its own repository, and cross-component changes are coordinated through documented contracts rather than shared code."
    rationale: "Separating components by repository enforces clear boundaries and allows each tool (Obsidian plugin, AI companion, integrations) to evolve independently without hidden coupling."

  - level: L1
    category: Architecture
    statement: "MiYo Kokoro is the authoritative repository for overarching design documentation, including high-level architecture, cross-repo contracts, governance rules, and key design decisions; other MiYo repos must not redefine or fork these project-wide principles."
    rationale: "Centralizing architecture and decision records in Kokoro ensures that all components align on the same mental model of MiYo and prevents divergence of core concepts across repos."

  - level: L2
    category: Architecture
    statement: "Any change that affects interactions between MiYo components (e.g., Kado ↔ Tomo protocols, shared concepts like tasks or notes) must be reflected in MiYo Kokoro as an updated design note or decision record before or alongside implementation."
    rationale: "Documenting cross-repo changes in Kokoro keeps integration behavior explicit and discoverable, reducing breakages when components evolve independently."

  - level: L2
    category: Architecture
    statement: "Each MiYo component repository must include a brief architecture overview that explains its role in the overall MiYo ecosystem and links back to the relevant sections in MiYo Kokoro."
    rationale: "Local docs in each repo help contributors understand how their component fits into MiYo as a whole while keeping Kokoro as the single source of truth for system-level design."

  - level: L2
    category: Architecture
    statement: "MiYo Kado must aim to support multiple relevant Obsidian API and MCP protocol versions concurrently where feasible, only introducing breaking changes to its public behavior when no compatible path exists."
    rationale: "Supporting multiple API versions where possible reduces breakage risk for users and downstream AI tools relying on the shared MCP server."

  - level: L2
    category: Architecture
    statement: "When MiYo Kado must introduce a breaking change in response to Obsidian or MCP protocol changes, the breaking behavior and migration path must be documented in MiYo Kokoro and in Kado’s own repository."
    rationale: "Documenting breaking changes and migrations helps users and integrators adapt smoothly when host APIs or protocols evolve."

  # CODE QUALITY
  - level: L1
    category: Code Quality
    statement: "Implementation work in any MiYo repository must trace back to an approved spec or design note (e.g., from MiYo Kokoro or the local specs directory), and pull requests must reference the relevant spec ID or document."
    rationale: "Spec-driven development is the core workflow; explicitly linking code changes to specs prevents scope creep and keeps behavior aligned with documented intent."

  - level: L1
    category: Code Quality
    statement: "MiYo Kado, MiYo Tomo, and future components must maintain a clean separation between core logic and AI-orchestration glue code, so that domain behavior is testable without requiring an AI in the loop."
    rationale: "Separating domain logic from AI orchestration makes it possible to unit-test PKM behavior, reuse capabilities across tools, and avoid coupling core functionality to a specific AI integration."

  - level: L2
    category: Code Quality
    statement: "All TypeScript or JavaScript code in MiYo repositories must pass configured linters and formatters (e.g., ESLint and Prettier) with zero errors before merging, and code review should treat new lint disables as security/quality smells."
    rationale: "Consistent style and static checks reduce bugs and make it easier for AI tools and humans to understand and safely modify the codebase."

  - level: L2
    category: Code Quality
    statement: "Files that implement core behaviors (e.g., access control in Kado, PKM operations in Tomo) should remain small and focused; if a file grows beyond an agreed threshold (e.g., ~300–500 LOC), it should be refactored into smaller modules."
    rationale: "Keeping core files small and cohesive improves readability, reduces cognitive load, and helps AI-powered reviews reason accurately about behavior."

  - level: L2
    category: Code Quality
    statement: "Public interfaces between MiYo components (e.g., MCP tool schemas, shared PKM concepts, configuration formats) must be defined with clear types and documented expectations, and changes to these interfaces require explicit review for backward compatibility."
    rationale: "Well-typed, documented contracts between repos prevent subtle integration bugs and make it easier for external tools and future components to integrate safely."

  - level: L3
    category: Code Quality
    statement: "When adding new features, contributors should prefer extending existing patterns and abstractions documented in MiYo Kokoro over introducing entirely new ones, unless a design note justifies the divergence."
    rationale: "Reusing established patterns keeps the ecosystem coherent and predictable, which benefits both human contributors and AI coding agents."

  # TESTING
  - level: L1
    category: Testing
    statement: "Any code path in MiYo Kado that performs filesystem access (read, write, update, delete, or path discovery) must have automated tests covering at least the happy path and one failure or denial case for each exposed MCP tool."
    rationale: "Kado’s MCP tools are the main gateway to sensitive PKM data; testing both success and denial/failure cases for each tool reduces the risk of accidental overexposure or destructive bugs."

  - level: L1
    category: Testing
    statement: "Before merging, new or changed behavior in access control (blacklist/whitelist evaluation, API-key scoping, CRUD checks) must be covered by tests that prove both correct authorization and correct rejection for representative paths and permissions."
    rationale: "The double access control model is central to MiYo’s security; regressions here must be caught by tests rather than discovered in user vaults."

  - level: L2
    category: Testing
    statement: "For MiYo Tomo and other PKM-related logic, core operations that mutate user data (e.g., creating, updating, restructuring notes or tasks) should be covered by automated tests that validate behavior against the relevant spec or acceptance criteria."
    rationale: "Tomo proposes and applies changes to PKM structures; aligning tests with specs stabilizes user-facing behavior and prevents unintentional transformations."

  - level: L2
    category: Testing
    statement: "MiYo components that expose MCP tools must provide at least basic integration tests that exercise tool registration, listing, and a small set of representative tool calls end-to-end using a test vault or test filesystem."
    rationale: "Unit tests alone are not enough for MCP servers; minimal end-to-end tests ensure that tools are discoverable and behave as expected when called through the protocol."

  - level: L2
    category: Testing
    statement: "When a bug is fixed in a MiYo component that affects filesystem access, access control, or data mutations, the fix should include a regression test that fails without the fix and passes with it."
    rationale: "Regression tests on critical paths reduce the chance of reintroducing subtle bugs that compromise safety or user trust."

  - level: L3
    category: Testing
    statement: "Where practical, tests for Obsidian-related behavior should prefer fakes or simulated vaults over running a full Obsidian UI, focusing on business logic rather than framework details."
    rationale: "Testing against fakes and simulated vaults keeps test suites fast and focused on MiYo’s core logic while still reflecting realistic PKM scenarios."

  # DEPENDENCIES
  - level: L1
    category: Dependencies
    statement: "MiYo repositories must avoid adding dependencies with strong copyleft or non-OSI-compatible licenses (e.g., GPL, AGPL, non-commercial Creative Commons) unless a deliberate licensing decision is recorded in MiYo Kokoro."
    rationale: "Strong copyleft and non-commercial licenses can silently change what MiYo is allowed to do with its code; requiring an explicit decision in Kokoro avoids accidental licensing lock-in."

  - level: L1
    category: Dependencies
    statement: "Each MiYo repository must declare all runtime dependencies in its package and build configuration files (e.g., package.json) with semver ranges that prevent unbounded major upgrades (no bare \"*\" or \"latest\" for core dependencies)."
    rationale: "Explicit, bounded dependency versions reduce the chance of unexpected breaking changes in users’ Obsidian setups or MCP environments."

  - level: L2
    category: Dependencies
    statement: "When introducing a new external service or SDK dependency (e.g., AI client, HTTP library), contributors should document in the repo README or MiYo Kokoro why this dependency is needed and what alternatives were considered."
    rationale: "Documenting the reasons for new external dependencies makes it easier to revisit decisions later, swap out providers, or reduce the dependency footprint."

  - level: L2
    category: Dependencies
    statement: "Security- or protocol-critical dependencies for MiYo Kado (e.g., filesystem, MCP, or crypto-related libraries) should be kept as small and well-maintained as practical, preferring widely used, actively maintained packages over obscure ones."
    rationale: "Relying on actively maintained, widely used libraries for critical paths reduces security and maintenance risks in the MCP server."

  - level: L2
    category: Dependencies
    statement: "MiYo repositories should be kept free of unused dependencies; build or tooling changes that remove code should also remove now-unused packages from configuration files."
    rationale: "Removing unused dependencies reduces attack surface, simplifies updates, and keeps the mental model of each repo’s responsibilities clear."

  - level: L3
    category: Dependencies
    statement: "Where feasible, MiYo projects should use automated tools (e.g., dependency scanners or license checkers) in CI to flag known vulnerable dependencies or license issues before release."
    rationale: "Automated checks provide early warning of security or license problems in dependencies without imposing heavy manual tracking overhead."

  # PERFORMANCE
  - level: L1
    category: Performance
    statement: "MiYo Kado must not perform long-running or CPU-intensive work synchronously on Obsidian’s main UI thread; file scans, large operations, or heavy computations must be batched, debounced, or offloaded so they do not cause noticeable typing lag or UI freezes."
    rationale: "Users experience PKM tools primarily through Obsidian’s responsiveness; keeping heavy work off the main thread prevents Kado from making the editor feel sluggish, especially in large vaults."

  - level: L1
    category: Performance
    statement: "MiYo Kado must use a queue or equivalent mechanism for executing allowed MCP requests when work is long-running or concurrent, ensuring that Obsidian remains responsive even when multiple AI tools share the same MCP server."
    rationale: "Queuing long-running work prevents concurrent heavy operations from overwhelming the environment and keeps the user’s PKM experience responsive."

  - level: L1
    category: Performance
    statement: "For MCP tools that can produce large result sets (e.g., many files or long content), MiYo Kado must support chunked or paginated responses rather than returning unbounded payloads in a single call."
    rationale: "Chunking large results protects performance and memory, reduces token usage with external AIs, and allows clients to progressively consume data."

  - level: L2
    category: Performance
    statement: "Responses returned by MiYo Kado to external AIs should avoid unnecessary data and be shaped to include only the fields the AI actually needs, especially for JSON payloads."
    rationale: "Trimming responses reduces latency and token usage, preserves model context window capacity, and improves responsiveness in multi-call agent workflows."

  - level: L2
    category: Performance
    statement: "MiYo Tomo and other AI-integrating components should avoid issuing redundant or highly parallel AI calls for the same context; where possible, they should reuse results, batch related operations, or cache recent queries within a session."
    rationale: "Excessive or duplicated AI calls increase latency and cost; batching and caching help maintain a snappy user experience when interacting with MiYo as a companion."

  - level: L2
    category: Performance
    statement: "MiYo Kado should leverage Obsidian’s Vault API and caching behavior rather than re-implementing its own full vault scans when reading files that Obsidian already knows about."
    rationale: "Using the host application’s APIs and caches avoids redundant I/O and reduces the performance impact of plugins on large vaults."

  - level: L3
    category: Performance
    statement: "Where practical, MiYo components should measure and log basic performance metrics for heavy operations (e.g., time taken for large refactors, MCP calls over many files) to inform future optimization, without storing sensitive content."
    rationale: "Lightweight metrics help identify real-world bottlenecks and guide targeted performance improvements without over-instrumenting the codebase or leaking PKM data."
```

Enforcement Notes
•	L1 (Must) rules are intended to be enforced automatically wherever possible during the  /implement ,  /test , and  /review  phases of your spec-driven workflow (e.g., via lint rules, schema checks, automated tests, or CI gates). cite:1
•	L2 (Should) rules should be checked during code review and by targeted tooling where feasible (e.g., test coverage on critical paths, dependency and license checks, architectural reviews).
•	L3 (May) rules are advisory and capture preferred patterns and practices that can guide design discussions and future refactors without blocking changes.
