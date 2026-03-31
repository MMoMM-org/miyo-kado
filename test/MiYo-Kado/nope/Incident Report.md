---
title: Incident Report 2026-03
date: 2026-03-15
type: incident
tags:
  - incident
  - postmortem
severity: P1
resolved: true
---

# Incident Report — 2026-03-15

## Summary

Database connection pool exhausted during peak traffic.

## Timeline

- 14:23 — Alerts triggered
- 14:31 — Root cause identified
- 14:45 — Pool size increased, traffic stabilized
- 15:00 — All clear

## Lessons Learned

Connection pooling defaults were too conservative for current load.

[mttr:: 37min]
[affected-users:: 1200]
