import { Pin, Rotate3d } from 'lucide-react';
import type { SimulatorToolIcon } from './tools/types';

/** The glyph for each tool icon, shared by the rail and the phone's Tools pill. */
export const SIMULATOR_TOOL_ICONS: Record<SimulatorToolIcon, typeof Pin> = {
  orbit: Rotate3d,
  pin: Pin,
};
