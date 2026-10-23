import { pleatMaterialPoint } from '../tools/pleat/pleatStep';
import { useEffect, useMemo, useState } from 'react';
import { reportError } from '../../monitoring';
import type { FoldAxiomCandidate, FoldCrossSection } from '../engine/foldEngineWire';
import type { FoldSessionSurface } from '../session/useFoldSession';
import { foldCrossSectionQuery } from '../session/foldStateQueries';
import { FOLD_EVERY_LAYER, type FoldResolvedSeed, type FoldToolState } from '../tools/foldToolState';
import { lineSectionProbe, seedForTool, topFlapSeed } from '../tools/topFlapSeed';
import { reverseMaterialPoint, reverseMaterialSeed } from '../tools/reverse/reverseMaterialSeed';
import { reverseDrawnSegment, reverseSegmentSeed } from '../tools/reverse/reverseSegmentSeed';
import type { FoldPickIndex } from './foldPicking';

/** The section at the line the picks locate, and the seed a step is built with. */
export interface FoldLineSection {
  /**
   * The cross-section at the located line on its moving side: null for a
   * fold that does not resolve its default seed here (its section comes with its
   * analysis), while it is asked, and when the engine refuses it.
   */
  section: FoldCrossSection | null;
  /**
   * The tools' default seed resolved: the top flap, a reverse fold's
   * material picked on the CP, or the flaps its drawn line crosses
   * (`reverseSegmentSeed`). Null while the section that seed is read
   * from is still being asked: there is no step to build yet.
   */
  seed: FoldResolvedSeed | null;
}

/**
 * The cross-section at the line a fold requiring a default flap locates
 * (`lineSectionProbe`), asked once per line and side on a state as soon as
 * every click is in (plan D14 tier 2) — before any step is built, since the
 * default seed is read from it — and the tools' seed resolved against it
 * (owner request, 2026-10-13: a fold takes the top flap, not every layer).
 *
 * Resolved here rather than written into the tools by an effect, so the
 * preview and a commit can never see a seed the chips do not: no step is
 * built until the default flap is known, and every one built is built with it.
 * A section the engine refuses (a near miss, no paper on the side) resolves
 * to every layer, whose fold the engine then refuses and words as before.
 */
export function useFoldLineSection(
  session: FoldSessionSurface,
  index: FoldPickIndex | null,
  tools: FoldToolState,
  candidate: FoldAxiomCandidate | null,
  secondCandidate: FoldAxiomCandidate | null = null
): FoldLineSection {
  const { query, peek } = session;
  const state = session.cursor.state;
  const stateKey = state ? `${state.generation}:${state.id}` : null;
  const { tool, lineMode, secondLineMode, picks, swapped, override } = tools;
  const probe = useMemo(
    () => (index ? lineSectionProbe({ tool, lineMode, secondLineMode, picks, swapped, override }, index, candidate, secondCandidate) : null),
    [index, tool, lineMode, secondLineMode, picks, swapped, override, candidate, secondCandidate]
  );
  const key = probe && stateKey ? `${stateKey}|${probe.key}` : null;
  // A pure query on the state on screen: an axiom's roots may have brought
  // its answer with them (`FoldSession.axiomRoots`), read here as it renders.
  const sectionQuery = useMemo(() => (probe ? foldCrossSectionQuery(probe.line, probe.side) : null), [probe]);
  const held = state && sectionQuery ? peek(state, sectionQuery) : null;
  const [answer, setAnswer] = useState<{ key: string; section: FoldCrossSection | null } | null>(null);
  useEffect(() => {
    if (!state || !sectionQuery || key === null || answer?.key === key || held) return undefined;
    let current = true;
    void query(state, sectionQuery).then(
      (reply) => {
        if (!current || reply.status !== 'answered') return;
        setAnswer({ key, section: reply.value.status === 'ok' ? reply.value.section : null });
      },
      (error: unknown) => {
        reportError(error, { surface: 'fold:line-section' });
        // Never left waiting: every layer, as a section refused.
        if (current) setAnswer({ key, section: null });
      }
    );
    return () => {
      current = false;
    };
    // The probe is read through its key: an equal line and side must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, key, answer?.key, held]);

  const heldValue = held?.value;
  const own = useMemo(
    () =>
      key !== null && heldValue
        ? { key, section: heldValue.status === 'ok' ? heldValue.section : null }
        : answer && answer.key === key
          ? answer
          : null,
    [key, heldValue, answer]
  );
  const asked = seedForTool(tool, tools.seed);
  const material = reverseMaterialPoint(tools) ?? (index ? pleatMaterialPoint(tools, index) : null);
  const drawn = useMemo(() => reverseDrawnSegment({ tool, lineMode, picks, override }), [tool, lineMode, picks, override]);
  const seed = useMemo<FoldResolvedSeed | null>(() => {
    if (tools.seed.scope === 'top' && material && index && probe) {
      if (!own) return null;
      return own.section ? reverseMaterialSeed(index.scene, own.section, material) : FOLD_EVERY_LAYER;
    }
    if (tools.seed.scope === 'top' && drawn && probe) {
      if (!own) return null;
      return own.section ? reverseSegmentSeed(own.section, drawn) : FOLD_EVERY_LAYER;
    }
    if (asked.scope !== 'top') return asked;
    // No line to read a top flap at: the step, if any, is every layer's — a
    // bend unfolded (its top flap hinged on it), a fix's line, or a fold the
    // tools refuse before the engine is asked.
    if (!probe) return FOLD_EVERY_LAYER;
    if (!own) return null;
    return own.section ? topFlapSeed(own.section) : FOLD_EVERY_LAYER;
  }, [asked, probe, own, tools.seed.scope, material, drawn, index]);
  return { section: own?.section ?? null, seed };
}
