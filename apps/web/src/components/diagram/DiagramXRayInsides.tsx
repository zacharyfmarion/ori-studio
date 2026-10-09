import type { XRayInsideDrawn } from '../../diagram/xray/useXRayInsides';

/**
 * The x-rays' windows on the Annotate canvas (Revision 3), under the marks and
 * the close-ups' insides, as every surface paints them (`xrayWindowMarkup`):
 * each its clip, the page's white, the faces left and its rim — one markup,
 * the painters' own, so the canvas shows what a page prints. In the drawing's
 * px, as the marks are. Nothing here takes a press: a window is found by its
 * rim (`annotationHit`), and the marks over it stay pressable.
 */
export function DiagramXRayInsides({ insides }: { insides: readonly XRayInsideDrawn[] }) {
  if (insides.length === 0) return null;
  return (
    <g data-x-ray-insides="">
      {insides.map((inside) => (
        <g
          key={inside.id}
          data-x-ray-inside={inside.id}
          // The painters' markup, made from the stored scene's faces and the style's pens: no text of anyone's in it.
          dangerouslySetInnerHTML={{ __html: inside.markup }}
        />
      ))}
    </g>
  );
}
