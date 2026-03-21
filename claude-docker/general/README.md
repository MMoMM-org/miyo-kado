# general/

Minimal Docker variant. No ClamAV, no Socket CLI, no security restrictions.

For environments where security tools add too much overhead or are not needed.

## Dockerfile

The Dockerfile for this variant is in the parent directory as a `--target general` stage in the master multi-stage `Dockerfile`.

## Image label

`claude-code-general:1.0`
