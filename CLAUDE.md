# live.versatile.sh

## Workflow (owner rule, 2026-11-16)

Every change reaches `main` through a pull request from a feature branch, in small increments, merged one at a time. This repo is an explicit exception to the global "no pull requests" rule. No AI co-author trailer.

## Research

The architecture study lives in `docs/research/` (charter, scouts, round, spikes, synthesis). Decisions are recorded as ADRs in `docs/adr/`.

## Engineering taste (owner rule, 2026-11-16)

Prefer the precise technique where a problem really has that shape: bitwise flags and bitmaps for participant and track state, a Bloom or cuckoo filter for membership tests, a timing wheel for deadlines, ring buffers, lock-free counters. Each one is named in an ADR with the problem it fits and the measurement that justifies it. Never add one for show.
