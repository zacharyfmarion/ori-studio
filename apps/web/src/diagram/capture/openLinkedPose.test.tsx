import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { publishOpenLinkedPose, useOpenLinkedPose } from './openLinkedPose';
import type { DiagramLinkedPose } from './useDiagramLinkedPose';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pose = (): DiagramLinkedPose => ({
  actions: [],
  layerOrder: null,
  spatial: null,
  onCamera: () => {},
  registerLiveView: () => () => {},
  rotateTo: () => {},
  showAs: async () => true,
  setSide: async () => true,
  simulate: async () => {},
  wantsRest: () => false,
  spread: null,
  preview: null,
});

afterEach(() => publishOpenLinkedPose(null, null));

describe('the open step’s linked Pose', () => {
  it('reaches a surface asking for that step, and no other, until it is let go', () => {
    const seen: (DiagramLinkedPose | null)[] = [];
    function Probe({ stepId }: { stepId: string }) {
      seen.push(useOpenLinkedPose(stepId));
      return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<Probe stepId="step-a" />));
    const open = pose();
    act(() => publishOpenLinkedPose('step-a', open));
    expect(seen.at(-1)).toBe(open);
    act(() => root.render(<Probe stepId="step-b" />));
    expect(seen.at(-1)).toBeNull();
    act(() => root.render(<Probe stepId="step-a" />));
    act(() => publishOpenLinkedPose(null, null));
    expect(seen.at(-1)).toBeNull();
    act(() => root.unmount());
  });
});
