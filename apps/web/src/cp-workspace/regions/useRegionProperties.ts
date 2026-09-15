import { useMemo } from 'react';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import { useAnnotationPaneDeps } from '../annotations/useAnnotationPaneDeps';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { buildRegionProperties } from './regionProperties';

/** The region sheet, bound to the store through the annotation layer's pane deps. */
export function useRegionProperties(target: TargetOf<'suppressionRegion'>): PropertySheet {
  const deps = useAnnotationPaneDeps(target.id);
  return useMemo(() => buildRegionProperties(target, deps), [target, deps]);
}
