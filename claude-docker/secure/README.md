# secure/

Hardened Docker variant. Includes:
- ClamAV antivirus (PostToolUse scanning + 2x daily scheduled)
- Socket CLI supply-chain scanning (npm/bun installs)
- pipx + pip-audit (Python security)
- Capability restrictions: --cap-drop ALL + --cap-add CHOWN + DAC_OVERRIDE
- Memory limit: 2g, CPU limit: 2
- Security scripts baked in at /usr/local/bin/claude-scripts/

## Dockerfile

The Dockerfile for this variant is in the parent directory as a `--target secure` stage in the master multi-stage `Dockerfile`.

## Image label

`claude-code-secure:1.0`

## Security hooks wiring

The security PreToolUse and PostToolUse hooks are wired via `settings.json` in `claude-docker-home/`
by the install script — NOT baked into this template (allows updating without rebuild).
