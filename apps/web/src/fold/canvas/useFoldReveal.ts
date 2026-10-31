import { useEffect, useLayoutEffect, useCallback, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { clampReveal } from '../../cp-workspace/folded/layerSpreadSettings';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { shownFoldSequence } from '../../store/workspaceStore/foldState';
import { trackFoldSpreadChanged } from '../../analytics';
import { registerFoldCancel, registerFoldKeyHandler } from '../sequence/foldKeys';
import { foldAdjustSpreadAction } from './foldSpreadActions';
import { useFoldTools } from '../tools/foldToolState';

export interface FoldRevealGesture {
  down: (event: PointerEvent) => boolean;
  move: (event: PointerEvent) => boolean;
  end: (event: PointerEvent) => boolean;
}
/** Reveal is a view gesture. Only its end edits the step, producing one undo;
 * Escape and pointer cancellation simply discard the local preview. */
export function useFoldReveal(stepId: string | null, spread: LayerSpreadOptions | null, enabled: boolean) {
  const { t } = useTranslation();
  const readOnly = useWorkspaceStore((s) => shownFoldSequence(s)?.readOnlyRaw != null);
  const loadId = useWorkspaceStore((s) => s.foldLoadId);
  const tool = useFoldTools((s) => s.tool);
  const lineMode = useFoldTools((s) => s.lineMode);
  const [active, setActive] = useState(false),
    [preview, setPreview] = useState<LayerSpreadOptions | null>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    start: Extract<LayerSpreadOptions, { kind: 'connected' }>;
    shown: Extract<LayerSpreadOptions, { kind: 'connected' }>;
  } | null>(null);
  const available = enabled && !readOnly && !!stepId && spread?.kind === 'connected';
  const current = useRef({ active, available, stepId, spread, loadId });
  useLayoutEffect(() => {
    current.current = { active, available, stepId, spread, loadId };
  }, [active, available, stepId, spread, loadId]);
  useEffect(() => {
    if (!available) {
      gesture.current = null;
      setPreview(null);
      setActive(false);
    }
  }, [available]);
  useEffect(() => {
    gesture.current = null;
    setPreview(null);
    setActive(false);
  }, [stepId, loadId, tool, lineMode]);
  useEffect(() => {
    const cancel = () => {
      if (!current.current.active) return false;
      gesture.current = null;
      setPreview(null);
      setActive(false);
      return true;
    };
    const off = registerFoldCancel(cancel);
    const key = registerFoldKeyHandler((id) => {
      if (id !== 'fold.adjustSpread' || !current.current.available) return false;
      setActive((a) => !a);
      return true;
    });
    return () => {
      off();
      key();
    };
  }, []);
  const claim = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const handlers: FoldRevealGesture = {
    down: (event) => {
      if (!active || !available || spread?.kind !== 'connected' || event.button !== 0) return false;
      claim(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: spread, shown: spread };
      return true;
    },
    move: (event) => {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return false;
      claim(event);
      const box = event.currentTarget.getBoundingClientRect(),
        unit = Math.max(100, Math.min(box.width, box.height)) * 0.22;
      g.shown = {
        ...g.start,
        reveal: clampReveal([
          g.start.reveal[0] + (event.clientX - g.x) / unit,
          g.start.reveal[1] + (event.clientY - g.y) / unit,
        ]),
      };
      setPreview(g.shown);
      return true;
    },
    end: (event) => {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return false;
      claim(event);
      gesture.current = null;
      setPreview(null);
      if (event.type !== 'pointercancel' && stepId) {
        const changed = useWorkspaceStore.getState().setFoldStepSpread(stepId, g.shown, { loadId });
        if (changed) trackFoldSpreadChanged('spread_reveal', 'canvas_bar', g.shown);
      }
      return true;
    },
  };
  const toggle = useCallback(() => {
    if (!available) return;
    setActive((a) => !a);
    setPreview(null);
    gesture.current = null;
  }, [available]);
  return {
    shown: available && preview ? preview : spread,
    gesture: active && available ? handlers : undefined,
    action: { ...foldAdjustSpreadAction(active && available, available, t), run: toggle },
  };
}
