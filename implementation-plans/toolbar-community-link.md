# Toolbar header button changes

## Goal

Two changes to the workspace header (`Toolbar` in `WorkspaceShell.tsx`):

1. The desktop-download affordance must not appear on a phone. A phone cannot
   run a desktop build, so the control is offering something the device cannot
   take — on the surface with the least room to spare.
2. The New / Open / Save icon trio comes out, and a link to the community
   Discord goes in.

The trio was always duplication: all three are unconditional File-menu entries,
which is why the phone layout already hid them in CSS. Removing them everywhere
makes that a fact about the toolbar rather than a fact about phones, and frees
the space for something the menus do not carry.

## Approach

- **Phone gate.** `ToolbarDownloadButton` becomes a two-part component: an outer
  gate that asks `useIsPhoneLayout()`, and an inner body holding the hook and
  the menu. Gating on the outside means the phone never mounts
  `useDesktopDownloads` at all, so it never makes the GitHub release request —
  which a CSS `display: none` would still pay for.
- **Discord link.** An anchor, not a button that calls `window.open` — the
  argument `ButtonLink` already makes. There is no icon-sized version of that
  primitive, so add `IconButtonLink` beside `IconButton`, sharing its `cva`,
  its tooltip and its touch-label hold.
- **Analytics.** A new hand-placed `community link opened` event. Nothing here
  dispatches through `handleMenuAction`, so the `command invoked` chokepoint
  cannot see it, and "does anyone press this" is the question that decides
  whether the control keeps its slot.
- **Dead CSS.** `.toolbar__action--file` and its `:has()` companion in the phone
  block have nothing left to hide; the `::before` spacer's comment justifies
  itself by those buttons and needs rewriting rather than deleting.

## Affected Areas

- `apps/web/src/components/WorkspaceShell.tsx`
- `apps/web/src/components/download/ToolbarDownloadButton.tsx`
- `apps/web/src/components/ui/IconButton.tsx`
- `apps/web/src/components/MenuBar.tsx` (a comment that names the CSS rule)
- `apps/web/src/App.css` (the phone block)
- `apps/web/src/analytics/events.ts`, `apps/web/src/analytics/index.ts`
- `apps/web/public/locales/*` + `.hashes.json`
- `docs/analytics.md`

## Checklist

- [x] Gate `ToolbarDownloadButton` on the phone layout, without mounting the fetch
- [x] Remove New / Open / Save and their leading separator from the toolbar
- [x] Add `IconButtonLink` to the `ui` primitives
- [x] Add the Discord link to the toolbar
- [x] Add the `community link opened` event and document it
- [x] Drop the dead `.toolbar__action--file` rules; correct the comments that cite them
- [x] Tests: the phone gate, and the toolbar's link
- [x] i18n: extract, translate the new key into all eight targets, stamp
- [x] Validate: lint, i18n check, typecheck, unit tests
