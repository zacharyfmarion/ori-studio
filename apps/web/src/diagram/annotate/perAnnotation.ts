import type { KnownDiagramAnnotation } from '../document/diagramDocument';

/**
 * `compute`, remembered for each annotation object it is asked about.
 *
 * An annotation is never changed in place — every edit, and every step of a
 * drag, makes a new object — so what was worked out for an object is right
 * for as long as anything holds it, and goes when nothing does. A drag then
 * works out the one annotation in hand, and every other is read back.
 *
 * Pure: no DOM, no store.
 */
export function perAnnotation<T>(compute: (annotation: KnownDiagramAnnotation) => T): (annotation: KnownDiagramAnnotation) => T {
  const cache = new WeakMap<KnownDiagramAnnotation, { value: T }>();
  return (annotation) => {
    const cached = cache.get(annotation);
    if (cached) return cached.value;
    const value = compute(annotation);
    cache.set(annotation, { value });
    return value;
  };
}
