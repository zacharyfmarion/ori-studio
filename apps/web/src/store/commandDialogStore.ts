import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  EMPTY_CREASE_EXPORT_CONTENT,
  type CreaseExportContent,
  type CreaseExportFoldedFigureSettings,
  type CreaseExportFormat,
  type CreaseExportOptions,
} from '../lib/creaseExport';
import type { CreaseExportFoldResult } from '../lib/creaseExportFold';
import type { FoldDocument } from '../engine/types';
import type { CpSegment } from '../lib/creasePatternSegmentation';

export type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
};

export type ConfirmWithOptionDialogOptions = {
  title: string;
  message: string;
  /** Label for the checkbox rendered under the message (e.g. "Don't show this again"). */
  optionLabel: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
};

export type ConfirmWithOptionResult = {
  /** Whether the user pressed the confirm button (vs. cancel/dismiss). */
  confirmed: boolean;
  /** Whether the checkbox was ticked. Reported for both confirm and cancel. */
  optionChecked: boolean;
};

export type NumberDialogOptions = {
  title: string;
  label: string;
  initialValue: string;
  confirmLabel?: string;
  cancelLabel?: string;
  minExclusive?: number;
  step?: number;
  meta?: string;
};

export type CreasePatternExportDialogOptions = {
  title: string;
  format: CreaseExportFormat;
  fold: FoldDocument;
  segments: CpSegment[];
  initialOptions: CreaseExportOptions;
  /**
   * Folds one crease pattern for the preview, or null when this workspace
   * cannot fold (no editable crease-pattern document). Injected rather than
   * imported so the dialog stays free of the kernel runtime.
   */
  foldSegment:
    | ((
        segment: CpSegment | null,
        settings: CreaseExportFoldedFigureSettings
      ) => Promise<CreaseExportFoldResult>)
    | null;
  confirmLabel?: string;
  cancelLabel?: string;
};

/**
 * What the export dialog resolves: the declarative options plus the content the
 * preview already resolved, so the exported file is exactly what was previewed.
 */
export type CreaseExportDialogResult = {
  options: CreaseExportOptions;
  content: CreaseExportContent;
};

export type CreasePatternExportDialog = { id: number; type: 'crease-export' } &
  CreasePatternExportDialogOptions;

export type CommandDialog =
  | ({ id: number; type: 'confirm' } & ConfirmDialogOptions)
  | ({ id: number; type: 'confirm-option' } & ConfirmWithOptionDialogOptions)
  | ({ id: number; type: 'number' } & NumberDialogOptions)
  | CreasePatternExportDialog;

interface CommandDialogState {
  dialog: CommandDialog | null;
  openDialog: (dialog: CommandDialog) => void;
  closeDialog: () => void;
}

let nextDialogId = 1;
let mountedHostCount = 0;
let pending:
  | { id: number; fallback: boolean; resolve: (value: boolean) => void }
  | { id: number; fallback: number | null; resolve: (value: number | null) => void }
  | {
      id: number;
      fallback: ConfirmWithOptionResult;
      resolve: (value: ConfirmWithOptionResult) => void;
    }
  | {
      id: number;
      fallback: CreaseExportDialogResult | null;
      resolve: (value: CreaseExportDialogResult | null) => void;
    }
  | null = null;

export const useCommandDialogStore = create<CommandDialogState>()(
  devtools(
    (set) => ({
      dialog: null,
      openDialog: (dialog) => set({ dialog }),
      closeDialog: () => set({ dialog: null }),
    }),
    { name: 'CommandDialogStore' }
  )
);

function clearPendingWithFallback() {
  if (!pending) return;
  pending.resolve(pending.fallback as never);
  pending = null;
}

export function registerCommandDialogHost(): () => void {
  mountedHostCount += 1;
  return () => {
    mountedHostCount = Math.max(0, mountedHostCount - 1);
    if (mountedHostCount === 0) {
      clearPendingWithFallback();
      useCommandDialogStore.getState().closeDialog();
    }
  };
}

export function requestConfirmation(options: ConfirmDialogOptions): Promise<boolean> {
  if (mountedHostCount === 0) return Promise.resolve(false);

  clearPendingWithFallback();
  const id = nextDialogId;
  nextDialogId += 1;
  return new Promise<boolean>((resolve) => {
    pending = { id, fallback: false, resolve };
    useCommandDialogStore.getState().openDialog({
      id,
      type: 'confirm',
      ...options,
    });
  });
}

export function requestConfirmationWithOption(
  options: ConfirmWithOptionDialogOptions
): Promise<ConfirmWithOptionResult> {
  const fallback: ConfirmWithOptionResult = { confirmed: false, optionChecked: false };
  if (mountedHostCount === 0) return Promise.resolve(fallback);

  clearPendingWithFallback();
  const id = nextDialogId;
  nextDialogId += 1;
  return new Promise<ConfirmWithOptionResult>((resolve) => {
    pending = { id, fallback, resolve };
    useCommandDialogStore.getState().openDialog({
      id,
      type: 'confirm-option',
      ...options,
    });
  });
}

export function requestPositiveNumber(options: NumberDialogOptions): Promise<number | null> {
  if (mountedHostCount === 0) return Promise.resolve(null);

  clearPendingWithFallback();
  const id = nextDialogId;
  nextDialogId += 1;
  return new Promise<number | null>((resolve) => {
    pending = { id, fallback: null, resolve };
    useCommandDialogStore.getState().openDialog({
      id,
      type: 'number',
      ...options,
    });
  });
}

export function requestCreasePatternExportOptions(
  options: CreasePatternExportDialogOptions
): Promise<CreaseExportDialogResult | null> {
  if (mountedHostCount === 0) {
    return Promise.resolve({
      options: options.initialOptions,
      content: EMPTY_CREASE_EXPORT_CONTENT,
    });
  }

  clearPendingWithFallback();
  const id = nextDialogId;
  nextDialogId += 1;
  return new Promise<CreaseExportDialogResult | null>((resolve) => {
    pending = { id, fallback: null, resolve };
    useCommandDialogStore.getState().openDialog({
      id,
      type: 'crease-export',
      ...options,
    });
  });
}

export function resolveCommandDialog(
  id: number,
  value: boolean | number | ConfirmWithOptionResult | CreaseExportDialogResult | null
): void {
  if (!pending || pending.id !== id) return;
  pending.resolve(value as never);
  pending = null;
  useCommandDialogStore.getState().closeDialog();
}

export function cancelCommandDialog(id: number): void {
  if (!pending || pending.id !== id) return;
  pending.resolve(pending.fallback as never);
  pending = null;
  useCommandDialogStore.getState().closeDialog();
}
