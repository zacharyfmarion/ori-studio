import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  CreaseExportFormat,
  CreaseExportOptions,
} from '../lib/creaseExport';
import type { FoldDocument } from '../engine/types';
import type { CpSegment } from '../lib/creasePatternSegmentation';

export type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
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
  confirmLabel?: string;
  cancelLabel?: string;
};

export type CommandDialog =
  | ({ id: number; type: 'confirm' } & ConfirmDialogOptions)
  | ({ id: number; type: 'number' } & NumberDialogOptions)
  | ({ id: number; type: 'crease-export' } & CreasePatternExportDialogOptions);

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
      fallback: CreaseExportOptions | null;
      resolve: (value: CreaseExportOptions | null) => void;
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
): Promise<CreaseExportOptions | null> {
  if (mountedHostCount === 0) return Promise.resolve(options.initialOptions);

  clearPendingWithFallback();
  const id = nextDialogId;
  nextDialogId += 1;
  return new Promise<CreaseExportOptions | null>((resolve) => {
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
  value: boolean | number | CreaseExportOptions | null
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
