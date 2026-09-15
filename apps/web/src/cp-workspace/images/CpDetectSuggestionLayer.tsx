import { CpDetectSuggestionPill } from './CpDetectSuggestionPill';
import { useCpDetectSuggestions } from './useCpDetectSuggestions';

/**
 * One pill per open offer, the way `CpRegionLayer` renders one chip per
 * region: a fragment of body-portaled pills, so it costs nothing wherever the
 * panel mounts it, and every binding comes from {@link useCpDetectSuggestions}
 * rather than from the panel.
 */
export function CpDetectSuggestionLayer({ container }: { container: HTMLElement | null }) {
  const { suggestions, acceptSuggestion, dismissSuggestion } = useCpDetectSuggestions();
  return (
    <>
      {suggestions.map(({ image }) => (
        <CpDetectSuggestionPill
          key={image.id}
          image={image}
          container={container}
          onDetect={() => acceptSuggestion(image.id)}
          onDismiss={() => dismissSuggestion(image.id)}
        />
      ))}
    </>
  );
}
