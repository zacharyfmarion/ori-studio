import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface SelectionUiState {
  isSelectByIndexOpen: boolean;
  openSelectByIndex: () => void;
  closeSelectByIndex: () => void;
}

export const useSelectionUiStore = create<SelectionUiState>()(
  devtools(
    (set) => ({
      isSelectByIndexOpen: false,
      openSelectByIndex: () => set({ isSelectByIndexOpen: true }),
      closeSelectByIndex: () => set({ isSelectByIndexOpen: false }),
    }),
    { name: 'SelectionUiStore' },
  ),
);
