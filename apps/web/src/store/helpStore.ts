import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export type HelpModalKind = 'about';

interface HelpState {
  activeModal: HelpModalKind | null;
  openAbout: () => void;
  closeHelp: () => void;
}

export const useHelpStore = create<HelpState>()(
  devtools(
    (set) => ({
      activeModal: null,
      openAbout: () => set({ activeModal: 'about' }),
      closeHelp: () => set({ activeModal: null }),
    }),
    { name: 'HelpStore' }
  )
);
