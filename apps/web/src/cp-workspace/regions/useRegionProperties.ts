import { useMemo } from 'react';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAnnotationPaneDeps } from '../annotations/useAnnotationPaneDeps';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { buildRegionProperties, type RegionPropertyDeps } from './regionProperties';
import { regionOwnedImage } from './useCpRegions';

/**
 * The region sheet, bound to the store through the annotation layer's pane
 * deps. The owned reference image is a direct lookup by `imageId` in the
 * annotation list — the entry as it sits there, a stable reference — never
 * the findings pass `useCpRegions` runs for the chip.
 */
export function useRegionProperties(target: TargetOf<'suppressionRegion'>): PropertySheet {
  const deps = useAnnotationPaneDeps(target.id);
  const region = target.annotation;
  const image = useWorkspaceStore((state) =>
    region.imageId ? regionOwnedImage(state.oristudioCpAnnotations, region) : null
  );
  const regionDeps = useMemo<RegionPropertyDeps>(() => ({ ...deps, image }), [deps, image]);
  return useMemo(() => buildRegionProperties(target, regionDeps), [target, regionDeps]);
}
