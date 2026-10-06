/**
 * Whether the Diagram is being made ready to print (`file.printDiagram`):
 * its pages laid out and drawn for the print dialog. The header's Print
 * button says so while it lasts, and a second Print waits for the first.
 */
import { create } from 'zustand';

interface DiagramPrintUiState {
  preparing: boolean;
  setPreparing: (preparing: boolean) => void;
}

export const useDiagramPrintUiStore = create<DiagramPrintUiState>()((set) => ({
  preparing: false,
  setPreparing: (preparing) => set({ preparing }),
}));
