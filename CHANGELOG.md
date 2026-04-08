## [0.1.6](https://github.com/MMoMM-org/miyo-kado/compare/0.1.5...0.1.6) (2026-04-08)


### Bug Fixes

* address ObsidianReviewBot feedback on submission ([c33e263](https://github.com/MMoMM-org/miyo-kado/commit/c33e2631ef7f39bd7bc7127a845284427a47a228))

## [0.1.5](https://github.com/MMoMM-org/miyo-kado/compare/0.1.4...0.1.5) (2026-04-08)


### Bug Fixes

* **manifest:** drop 'Obsidian' from description and end with period ([a3c8f7e](https://github.com/MMoMM-org/miyo-kado/commit/a3c8f7e6065c9fa125fc3a9b3944e257406f143f))

## [0.1.4](https://github.com/MMoMM-org/miyo-kado/compare/0.1.3...0.1.4) (2026-04-08)


### Bug Fixes

* **release:** drop v-prefix from release tags ([ecebee3](https://github.com/MMoMM-org/miyo-kado/commit/ecebee38cac71ef96f96645468097bbd23e03e5a))

## [0.1.3](https://github.com/MMoMM-org/miyo-kado/compare/v0.1.2...v0.1.3) (2026-04-08)


### Bug Fixes

* **release:** clean stale versions.json and always map current version ([f357a1c](https://github.com/MMoMM-org/miyo-kado/commit/f357a1c389aba47799f6a2ee06b7921d99646501))

## [0.1.2](https://github.com/MMoMM-org/miyo-kado/compare/v0.1.1...v0.1.2) (2026-04-08)


### Bug Fixes

* **release:** make package.json single source of truth for version ([ef062fe](https://github.com/MMoMM-org/miyo-kado/commit/ef062fe7643f8c7e1a50c448bdc5e650f5b03a6f))

## [0.1.1](https://github.com/MMoMM-org/miyo-kado/compare/v0.1.0...v0.1.1) (2026-04-08)


### Bug Fixes

* **release:** align manifest.json version with semantic-release tag ([75c9451](https://github.com/MMoMM-org/miyo-kado/commit/75c94512ab33e783c07972c30b4746701e82c991))

# [0.1.0](https://github.com/MMoMM-org/miyo-kado/compare/v0.0.0...v0.1.0) (2026-04-08)


### Bug Fixes

* adapter.write() workaround for Obsidian disk truncation ([0425d33](https://github.com/MMoMM-org/miyo-kado/commit/0425d33624edbb16b6e351569602c60a06b1c993))
* address code review findings (C1-C2, H1-H4, M1-M7, L1-L4) ([8284b48](https://github.com/MMoMM-org/miyo-kado/commit/8284b4817ca863bacf566cb8c279de857d96bbae))
* audit log directory auto-creation + audit log live tests ([dd4e7b6](https://github.com/MMoMM-org/miyo-kado/commit/dd4e7b6b1a394581863d94e81d4d47ff84d307a9))
* critical MCP client compatibility (C1, C2, C3) ([daa9275](https://github.com/MMoMM-org/miyo-kado/commit/daa9275dda364faea9cd154bd197da6268486163))
* hardening pass — all deferred review items resolved ([97141e3](https://github.com/MMoMM-org/miyo-kado/commit/97141e3f5162752e10d4d387977eefe53d809be6))
* hardening pass (M13, M14, H7, L4, L5, L8) ([49898ec](https://github.com/MMoMM-org/miyo-kado/commit/49898ec979bf8ea150036b6c9eee806fbeae4493))
* high-priority review items (H1, H2, H3, H4, H8, H9) ([df17d81](https://github.com/MMoMM-org/miyo-kado/commit/df17d814046dbeed4bcf25de4b02c8d53b2a0126)), closes [hi#priority](https://github.com/hi/issues/priority)
* **lint:** ignore vitest.live.config.ts in eslint project service ([9458351](https://github.com/MMoMM-org/miyo-kado/commit/9458351976718110920f872fce7ed0ed4be81b8e))
* live tests write deterministic config and handle rate limiting ([b5c605d](https://github.com/MMoMM-org/miyo-kado/commit/b5c605ded80f7d681489d94d374a830fa54a8973))
* remove double-write race in vault adapters ([2450da6](https://github.com/MMoMM-org/miyo-kado/commit/2450da6624f3629affd225ce4530ed2f7a22282e))
* resolve transient disk truncation in write test ([ea0e764](https://github.com/MMoMM-org/miyo-kado/commit/ea0e764fd8c680dcab840c7606d2db9fbb63ed1d))
* review items H5, H6, M1-M12, L1-L7 ([c57c823](https://github.com/MMoMM-org/miyo-kado/commit/c57c82317388336b757901c5f549dc7ac5fc18fa))
* second-pass review — remaining robustness and security items ([4a27b86](https://github.com/MMoMM-org/miyo-kado/commit/4a27b8631adfffa309a0b7a54e5c6768ce8a8a1f))
* **settings:** scope ApiKeyTab picker outside-click to tab DOM ([837d8f0](https://github.com/MMoMM-org/miyo-kado/commit/837d8f04cdfb9e1cd4738884616a2fe9724d359c))
* vault write flush + rate-limit headers + test hardening ([617ca61](https://github.com/MMoMM-org/miyo-kado/commit/617ca6160cdf8f9b9c34a30b757c56986c240773))


### Features

* add byContent and byFrontmatter search operations (F-18, F-19) ([92f4a87](https://github.com/MMoMM-org/miyo-kado/commit/92f4a87cecdd116731cbc9f0e78a89ccd5cdd069))
* add complete Kado v1 specification (PRD, SDD, PLAN) ([5b048f1](https://github.com/MMoMM-org/miyo-kado/commit/5b048f1c534e94745f4fef1df3882e4f166d6459))
* add Docker Claude Code environment (secure config v1.0) ([393b0a7](https://github.com/MMoMM-org/miyo-kado/commit/393b0a72a6742d652d06e6a87115e1d645ae268d))
* add project scaffolding, Docker env updates, and MiYo structure ([375d026](https://github.com/MMoMM-org/miyo-kado/commit/375d026ee350798d0175ed85f67a0f00cf5ec8ba))
* add release workflow, tests, and config updates ([272370f](https://github.com/MMoMM-org/miyo-kado/commit/272370fb9174790f3d673a60bcd0a34c44c9aab2))
* **audit:** buffered writes with 500ms flush timer (H5) ([f8336b4](https://github.com/MMoMM-org/miyo-kado/commit/f8336b4e92ebbd5ad678aea9c04d72a48b35e3f0))
* complete Kado v1 implementation (all 6 phases) ([4e53b79](https://github.com/MMoMM-org/miyo-kado/commit/4e53b7938d283d23f4e9dc613973f53e8d98f41d))
* **core:** add ConfigManager with TDD (T1.2) ([38e456b](https://github.com/MMoMM-org/miyo-kado/commit/38e456bacdcc066f6654b3cf64bcdd2b2f55e666))
* **core:** add DataTypePermissionGate with TDD (T2.4) ([5b22289](https://github.com/MMoMM-org/miyo-kado/commit/5b22289a5d9e58e5b619b39feb8d74e681e88b16))
* **core:** add GlobalScopeGate with TDD (T2.2) ([d3ee4c6](https://github.com/MMoMM-org/miyo-kado/commit/d3ee4c637a2c6e06c24bad2fc7166c81169cb1f5))
* **core:** add KeyScopeGate and shared glob-match utility (T2.3) ([9280874](https://github.com/MMoMM-org/miyo-kado/commit/9280874a76b4410569c0817ac923da44ae935c0b))
* **core:** add PathAccessGate with TDD (T2.5) ([afd1335](https://github.com/MMoMM-org/miyo-kado/commit/afd13350974da85fb06dbc2d66a37e6d2780d391))
* **logger:** gate kadoLog behind opt-in debugLogging setting ([e297e6b](https://github.com/MMoMM-org/miyo-kado/commit/e297e6bb78b7963f514b29c66e493a2cb435a194))
* MCP server hardening and search improvements ([63fd74c](https://github.com/MMoMM-org/miyo-kado/commit/63fd74cd34ecfcaed9655efc192707023eea71ca))
* **mcp:** periodic eviction of expired rate-limit entries (L8) ([edaa5c4](https://github.com/MMoMM-org/miyo-kado/commit/edaa5c4fb05f8414692344f68dae6aba7448ed6a)), closes [hi#traffic](https://github.com/hi/issues/traffic)
* Phase 1 — data model & config extensions for settings rework ([ed888a9](https://github.com/MMoMM-org/miyo-kado/commit/ed888a99ac8c12769df29192c9e162ea4168d6cf))
* Phase 2 — reusable UI components for settings rework ([60d2525](https://github.com/MMoMM-org/miyo-kado/commit/60d2525aa8d349e91e63e73e04b718bc4815bd0d))
* Phase 3 — settings tabs (General, Global Security, API Key) ([2493f66](https://github.com/MMoMM-org/miyo-kado/commit/2493f66113ddb026db19d546b82e71d2eafcfd2e))
* Phase 4 — wiring, audit migration, and settings.ts replacement ([64a0e6c](https://github.com/MMoMM-org/miyo-kado/commit/64a0e6cd8b5c10b8d3fd68976318d60af4e39d32))
* Phase 5 — integration tests, lint fixes, and polish ([168a2cd](https://github.com/MMoMM-org/miyo-kado/commit/168a2cd7c9849e0b5cb3368d5aeb635923fafa1c))
* **scaffold:** implement KadoPlugin entry point and settings tab (T1.3) ([86c27d6](https://github.com/MMoMM-org/miyo-kado/commit/86c27d6f862c694017fdd6cab0034c78c0f7c55f))
* **security:** validate glob patterns to prevent backtracking (L4) ([ce618a4](https://github.com/MMoMM-org/miyo-kado/commit/ce618a49027e3de310b4be6174727612d5eb2769))
* settings UI rework — single scope, per-path perms ([034c64c](https://github.com/MMoMM-org/miyo-kado/commit/034c64caa718ddd2f652f3056f707ce3d89af3ad))
* **T2.7:** add ConcurrencyGuard — validateConcurrency gate ([a29f05e](https://github.com/MMoMM-org/miyo-kado/commit/a29f05e31da9c89ba12abd33da20ae289e40f8fa))
* **T2.8:** add OperationRouter — routes CoreRequests to adapters ([e24dcbb](https://github.com/MMoMM-org/miyo-kado/commit/e24dcbbf7c82966556f89bceca4ed53f6ed3da1b))
* **T3.2:** add FrontmatterAdapter for Obsidian frontmatter read/write ([0184b77](https://github.com/MMoMM-org/miyo-kado/commit/0184b77aeda6d1c97e77e244e1558b27047986ac))
* **T3.3:** add FileAdapter for binary vault files with TDD ([69e14ee](https://github.com/MMoMM-org/miyo-kado/commit/69e14ee5be8f07960c8a7a6fcc2bee8614970764))
* **T3.4:** add InlineFieldAdapter — Dataview inline field read/write ([e2b9461](https://github.com/MMoMM-org/miyo-kado/commit/e2b94616489309d9e1b31d3c90f91bba9ff32145))
* **T4.1:** add MCP AuthMiddleware — Bearer token validation ([5534f6e](https://github.com/MMoMM-org/miyo-kado/commit/5534f6ee425153c74c29f2aae92fffc30172c881))
* **T4.3:** add registerTools — MCP tool registration layer ([31734ff](https://github.com/MMoMM-org/miyo-kado/commit/31734fffdbfe2b9d9702db61a69d72da6ed1cd40))
* **T4.5:** wire KadoPlugin — adapters, ConfigManager, MCP server ([af6ea7b](https://github.com/MMoMM-org/miyo-kado/commit/af6ea7bd820b2f43af2489295cb3ab3d9558e9d7))
* **T6.1:** add AuditLogger — NDJSON audit log with rotation support ([4d061bf](https://github.com/MMoMM-org/miyo-kado/commit/4d061bfb66b99b7f2633cb118d0d8f1adfee0808))
* **T6.2:** wire AuditLogger into tool handlers ([d452e0e](https://github.com/MMoMM-org/miyo-kado/commit/d452e0eae380e065932cd7eb0a3e70248d0914b1))
* **types:** add canonical type definitions for Kado Core (T1.1) ([bdd8cdb](https://github.com/MMoMM-org/miyo-kado/commit/bdd8cdb4573b960ce7a1b11cfc36327d29918a36))
* UI polish (F-9, F-12, F-16), README, PR template, concurrency cap ([143f447](https://github.com/MMoMM-org/miyo-kado/commit/143f4474c6511886a2107c5cb936360a3c79e819))
