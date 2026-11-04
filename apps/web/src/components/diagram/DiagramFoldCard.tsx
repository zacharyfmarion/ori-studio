import { useRef } from 'react';
import type { DiagramStep, DiagramStyle } from '../../diagram/document/diagramDocument';
import type { FoldBrowserCard } from '../../diagram/fold/foldPull';
import { useFoldPullPreview } from '../../diagram/fold/useFoldPullPreview';
import { useNearView, useStepPictureUrl } from '../../diagram/pictures/useStepPictureUrl';
import { PictureLoading } from '../ui/PictureLoading';
import { DiagramPullCard, DiagramPullCardCantDraw, DiagramPullCardPicture } from './DiagramReferencesCard';

const NO_ASSETS = Object.freeze({});

/**
 * One card of the Fold browser (plan D17): the step it would add, drawn as a
 * Diagram card draws a step — its state, spread as the step will be, with
 * its fold's line, arrow and circles over it (`useFoldPullPreview`) — on the
 * paper it prints on. Captured only as the card comes near the view. On its
 * way — the replay still to land the step, the card not yet near the view,
 * the capture running — the card shows the loading state; it says it can't
 * be drawn only when nothing will land, or the capture came to nothing.
 */
export function DiagramFoldCard({
  card,
  style,
  title,
  why,
  inDiagram,
  selected,
  tabStop,
  offered,
  choosable,
  onPress,
  onFocus,
}: {
  card: FoldBrowserCard;
  /** The diagram's: the pens the step will be drawn in. */
  style: DiagramStyle;
  title: string;
  /** Why it cannot be added, as its tooltip; absent when it can. */
  why?: string;
  /** The step already made from it, 1-based; null for none. */
  inDiagram: number | null;
  selected: boolean;
  tabStop: boolean;
  offered: boolean;
  choosable: boolean;
  onPress: (modifiers: { range: boolean }) => void;
  onFocus: () => void;
}) {
  const own = useRef<HTMLDivElement | null>(null);
  const near = useNearView(own);
  const { picture } = card;
  const preview = useFoldPullPreview(near && picture.status === 'landed' ? picture.preview : null);
  const shown = picture.status === 'none' ? null : near && picture.status === 'landed' ? preview : undefined;
  return (
    <DiagramPullCard
      ref={own}
      index={card.index}
      kind={card.kind}
      title={title}
      badge=""
      picture={
        shown ? (
          <FoldStepPicture step={shown} style={style} />
        ) : shown === undefined ? (
          <PictureLoading />
        ) : (
          <DiagramPullCardCantDraw />
        )
      }
      onPaper={Boolean(shown)}
      unreadable={card.step === null}
      why={why}
      sentence={card.sentence}
      ways={null}
      inDiagram={inDiagram}
      shownNow={false}
      selected={selected}
      tabStop={tabStop}
      offered={offered}
      choosable={choosable}
      onPress={onPress}
      onFocus={onFocus}
    />
  );
}

/** The step's picture as a Diagram card paints it: its marks over it, dotted where a flap covers them. */
function FoldStepPicture({ step, style }: { step: DiagramStep; style: DiagramStyle }) {
  const url = useStepPictureUrl(step, NO_ASSETS, style);
  return url ? <DiagramPullCardPicture url={url} /> : <DiagramPullCardCantDraw />;
}
