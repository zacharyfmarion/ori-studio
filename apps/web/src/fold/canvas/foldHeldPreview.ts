import type { FoldToolPreview } from './useFoldToolPreview';

/**
 * A preview's answers, as the panes and the tool window show them: what
 * moves, the layers at the line, the fold's picture, the state it lands or
 * why it does not, and a compound or vertex fold's own description.
 */
export type FoldHeldAnswer = Pick<
  FoldToolPreview,
  'analysis' | 'section' | 'action' | 'landed' | 'refused' | 'moverFix' | 'seedFix' | 'reverse' | 'crimp' | 'tuck' | 'vertex' | 'sink'
>;

/**
 * The preview the panes and the tool window show: the tools' own, or —
 * while a new seed's step for the same line is still being worked out or
 * landing (`FoldToolPreview.held`) — the last answer in place of every one
 * not in yet. What moves and the fold's picture are the new step's as soon as
 * they are known; the landed state, a refusal and a compound fold's choices
 * stay the last answer's until it has its own. Nothing goes and comes back
 * under the folder's click, and the window keeps its height: the chips stay
 * where they were pressed.
 *
 * It is still landing: there is nothing to commit until it has.
 */
export function foldShownPreview(preview: FoldToolPreview): FoldToolPreview {
  const { held } = preview;
  if (!held) return preview;
  return {
    ...preview,
    ...held,
    analysis: preview.analysis ?? held.analysis,
    section: preview.section ?? held.section,
    action: preview.action ?? held.action,
    landing: true,
  };
}
