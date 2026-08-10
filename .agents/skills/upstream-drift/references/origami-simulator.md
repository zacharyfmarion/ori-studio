# Origami Simulator

Amanda Ghassaei's dynamic folding solver. Unlike the other three this is not a
vendored copy — `packages/origami-simulator` is a TypeScript port, and a WebGL2
modernization of the original rather than a transliteration.

| | |
| --- | --- |
| Repo | `https://github.com/amandaghassaei/OrigamiSimulator` |
| Branch | `main` |
| Our code | `packages/origami-simulator` |
| Vendored at | *not vendored* — pin recorded in `packages/origami-simulator/NOTICE` |
| Manifest key | `origami-simulator` |

## Watch paths

The dynamic solver sources. Resolve the exact upstream paths from
`packages/origami-simulator/NOTICE`, which records the commit this port was
taken from.

The web page, demo models, and docs are `SKIP-UI`.

## Port map

| Upstream | Ours |
| --- | --- |
| dynamic solver | `packages/origami-simulator/src/` |

## Highest risk for this upstream: solver numerics

The integration step, force computation, damping, and axial / crease / face
stiffness. A change to any of these is invisible until a model diverges, goes
unstable, or renders blank. Tolerance, epsilon, and step-size changes are `PORT`
unconditionally.

Because our version is a modernization rather than a line-for-line port, a
`PORT` finding here needs more judgement than elsewhere: the upstream change may
already be structurally handled, or may not apply. Say which, with the file
reference, rather than assuming either way.

## A quiet result here means less than elsewhere

The public repository is close to dormant — roughly 3–5 commits a year since
2022, most recently 2025-11-20, and zero commits since our pin.

**Unreleased solver work is known to exist upstream that this repository does
not show.** The author of Box Pleating Studio, who also contributes here, stated
in July 2026 that he was working on Origami Simulator improvements that would
not be public for some time.

So a clean drift check here does **not** mean our port is current with the
author's intent. When the check comes back empty, say so explicitly in the PR
body so the empty result is not over-read as "we are up to date."

## Reverse direction

This is the one upstream where we may have improvements worth contributing
*back* — the WebGL2 modernization and some triangulation fixes. That is out of
scope for a drift check, but if a run surfaces an upstream change that overlaps
work we have already done, note it: it is a candidate for an upstream
contribution rather than a port.
