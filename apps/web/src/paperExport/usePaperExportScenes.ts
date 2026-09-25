/**
 * The scenes an export dialog's options call for, built from the target's
 * capture: one page, or every page of a set.
 *
 * The build runs once per key — the pages' scene keys together — and a build
 * that settles after the key has moved on is dropped. Until the scenes for the
 * key in hand have landed, the status reads `building`, from the very first
 * render that asks for a new key, so the preview can keep its last complete
 * page up rather than blank for a commit.
 */
import { useEffect, useRef, useState } from 'react';
import type { PaperScene } from '../lib/paper/paperScene';
import type { PaperExportSession } from './paperExportSession';
import type { PaperSceneInput } from './paperExportTarget';

/** Where the preview is: building a scene, showing one, or unable to. */
export type PaperExportStatus = 'building' | 'ready' | 'empty' | 'error';

export interface PaperExportScenes {
  /** The scenes for the key in hand, one per page asked for; empty until they land. */
  scenes: readonly PaperScene[];
  status: PaperExportStatus;
  error: string | null;
}

interface Built {
  key: string;
  scenes: readonly PaperScene[];
  status: PaperExportStatus;
  error: string | null;
}

const NOTHING: readonly PaperScene[] = [];

export function usePaperExportScenes(
  session: PaperExportSession,
  inputs: readonly PaperSceneInput[],
  key: string
): PaperExportScenes {
  const [built, setBuilt] = useState<Built>({ key: '', scenes: NOTHING, status: 'building', error: null });
  // The inputs a key stands for, read when the build starts; a ref so the
  // effect below runs per key rather than per render. Refreshed by the effect
  // declared first, so it is current when the build effect reads it.
  const inputsRef = useRef(inputs);
  useEffect(() => {
    inputsRef.current = inputs;
  });
  useEffect(() => {
    let current = true;
    Promise.all(inputsRef.current.map((input) => session.scene(input))).then(
      (scenes) => {
        if (!current) return;
        const complete = scenes.every((scene): scene is PaperScene => scene !== null);
        setBuilt({
          key,
          scenes: complete ? scenes : NOTHING,
          status: complete ? 'ready' : 'empty',
          error: null,
        });
      },
      (cause: unknown) => {
        if (!current) return;
        setBuilt({
          key,
          scenes: NOTHING,
          status: 'error',
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    );
    return () => {
      current = false;
    };
  }, [key, session]);

  if (built.key !== key) return { scenes: NOTHING, status: 'building', error: null };
  return { scenes: built.scenes, status: built.status, error: built.error };
}
