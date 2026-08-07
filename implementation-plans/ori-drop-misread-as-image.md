# `.ori` Drops Misread As Camera Raw Images

## Goal

Dropping a `.ori` file on the Edit workspace must open or import it exactly as a
`.fold` drop does. Today it is claimed by the reference-image importer and dies
in the console with `InvalidStateError: The source image could not be decoded.`

## Approach

### Root cause

`file.type` (and `DataTransferItem.type` during a drag) comes from the operating
system's extension table, which knows nothing about which extensions this app
owns. On macOS, `.ori` maps to the UTI `com.olympus.raw-image`, which conforms
to `public.image`, so the browser reports `image/x-olympus-orf` for an Oriedita
crease pattern:

```text
$ mdls -name kMDItemContentType probe.ori
kMDItemContentType = "com.olympus.raw-image"
```

Three independent places treat a leading `image/` as authoritative, and all
three misfire on that MIME type:

1. `isImageOnlyDrag` (`lib/fileDrop.ts`) reports the drag as image-only, so
   `useFileDropTarget` declines it: no overlay, and no `preventDefault` on the
   workspace element.
2. `isSupportedImageFile` (`cp-workspace/images/cpImageImport.ts`) makes the CP
   viewport's drop handler claim the file, `stopPropagation` it, and hand it to
   `createImageBitmap` — which throws, because no browser decodes camera raw.
   That is the reported error.
3. `classifyDroppedFile` (`lib/fileDrop.ts`) tests MIME before the extension, so
   even a `.ori` that reached the workspace target would be refused as an image.

The doc comment on `classifyDroppedFile` already asserts the correct rule — that
`.cp`, `.fold`, `.ori`, and `.orh` must be classified by extension — but states
as its premise that those extensions carry no MIME type. That premise is what is
wrong, and the code follows the premise rather than the rule.

### Fix

Two rules, applied wherever a dropped file is classified:

- **An extension this app owns wins over MIME, outright.** A file named `*.ori`
  is an Oriedita crease pattern whatever the platform calls it.
- **The image path requires a format a browser can actually decode.** Testing
  the `image/` prefix admits camera-raw types that can only ever throw. An
  allowlist of web-decodable types is the one signal available while a drag is
  still in flight, where the filename cannot be read.

Both are needed. The first alone leaves the workspace target declining `.ori`
drags at `dragover`, which still breaks the Welcome route (no viewport handler
there, so no `preventDefault`, so no `drop` event at all).

The viewport's drop handler switches to the shared `classifyDroppedFile`, so the
two targets cannot disagree about what an image is — the disagreement is what let
a `.ori` fall between them.

### Adjacent path, same cause

`accept="image/*"` on the Insert-image picker also offers `.ori` on macOS, for
the same UTI reason, and a decode failure there is only a `console.error`. The
picker is narrowed to the decodable list, and the failure is surfaced to the
user.

## Affected Areas

- `apps/web/src/lib/imageFormats.ts` (new): the decodable-image predicate.
- `apps/web/src/lib/fileDrop.ts`: extension-first classification; drag guard.
- `apps/web/src/cp-workspace/annotations/useCpAnnotations.ts`: viewport drop
  agrees with the workspace target; visible decode failure.
- `apps/web/src/cp-workspace/images/cpImageImport.ts`: drop the MIME-prefix test.
- `apps/web/src/components/panels/CreasePatternPanel.tsx`: narrow `accept`.
- Tests: `lib/imageFormats.test.ts`, `lib/fileDrop.test.ts`,
  `hooks/useFileDropTarget.test.tsx`, `commands/fileDropController.test.ts`.
- i18n catalogs for the new error string.

## Checklist

- [x] Reproduce the OS-level MIME mapping that causes the misclassification
- [x] Add `lib/imageFormats.ts` with the decodable-image predicate and tests
- [x] Make `classifyDroppedFile` resolve owned extensions before MIME
- [x] Make `isImageOnlyDrag` test decodability rather than the `image/` prefix
- [x] Point the CP viewport's drop handler at the shared classifier
- [x] Remove the now-dead `isSupportedImageFile`
- [x] Narrow the Insert-image `accept` list and surface decode failures
- [x] Add regression tests covering a `.ori` reported as `image/x-olympus-orf`
- [x] i18n extract, translate, stamp, check
- [x] Web lint, typecheck, unit tests
- [x] Browser-verify both directions: a `.ori` typed as Olympus raw takes the
      crease-pattern route on Edit and on Welcome, and a real PNG still lands as
      a reference image
