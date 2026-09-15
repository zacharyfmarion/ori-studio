import { useMemo } from 'react';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import { useAnnotationPaneDeps } from '../annotations/useAnnotationPaneDeps';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { buildImageProperties } from './imageProperties';

/** The image sheet, bound to the store through the annotation layer's pane deps. */
export function useImageProperties(target: TargetOf<'image'>): PropertySheet {
  const deps = useAnnotationPaneDeps(target.id);
  return useMemo(() => buildImageProperties(target, deps), [target, deps]);
}
