import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/**
 * Dev-only feature flag selecting the crease-pattern edit-surface renderer.
 *
 * This gates the in-progress SVG -> WebGL migration (see
 * implementation-plans/webgl-canvas-workspace-migration.md). It is intentionally
 * lightweight (localStorage-backed) because it is expected to be removed once
 * the WebGL renderer reaches parity and becomes the default.
 */
export type CpRendererMode = 'svg' | 'webgl';

export const CP_RENDERER_STORAGE_KEY = 'oristudio-cp-renderer-mode';

const DEFAULT_MODE: CpRendererMode = 'svg';

function isCpRendererMode(value: unknown): value is CpRendererMode {
  return value === 'svg' || value === 'webgl';
}

function loadSavedMode(): CpRendererMode {
  if (typeof localStorage === 'undefined') return DEFAULT_MODE;
  try {
    const saved = localStorage.getItem(CP_RENDERER_STORAGE_KEY);
    return isCpRendererMode(saved) ? saved : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function saveMode(mode: CpRendererMode): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CP_RENDERER_STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

interface CpRendererState {
  mode: CpRendererMode;
  setMode: (mode: CpRendererMode) => void;
}

export const useCpRendererStore = create<CpRendererState>()(
  devtools(
    (set) => ({
      mode: loadSavedMode(),
      setMode: (mode) => {
        saveMode(mode);
        set({ mode });
      },
    }),
    { name: 'CpRendererStore' }
  )
);
