import { useMemo } from 'react';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { buildTextProperties } from './textProperties';
import { useAnnotationPaneDeps } from './useAnnotationPaneDeps';

/** The text sheet, bound to the store through the annotation layer's pane deps. */
export function useTextProperties(target: TargetOf<'text'>): PropertySheet {
  const deps = useAnnotationPaneDeps(target.id);
  return useMemo(() => buildTextProperties(target, deps), [target, deps]);
}
