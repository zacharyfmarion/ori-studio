# Landing Carousel Gestures

## Goal

`LandingFeatureCarousel` currently renders a vertical list of titles beside a
panel that swaps instantly. It works, but it does not read as a carousel: there
is no motion between slides, nothing to drag, and on a narrow screen the tab list
becomes a scrollable pill row that competes with the page for horizontal swipes.

Turn it into a real carousel — slides that move, swipe on touch, drag on desktop,
snap and momentum — **without losing what the current one already gets right**:

- One tab stop for the whole control, not one per slide.
- Arrow keys in both orientations, Home/End.
- Every slide title visible, so a reader can see what is on offer and jump
  straight to it rather than waiting for it to come round.
- A panel that never changes height, so nothing below it moves.
- No autoplay.

That last set is the reason this is a plan and not a patch. The easy version of
"make it a carousel" is a transform-driven slider that throws all five away.

## Approach

### 1. Scroll-snap as the transport, not a JS animation loop

The slides become a horizontal scroll container:

```css
.landing-carousel__track {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 100%;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  /* Horizontal gestures drive the carousel; vertical ones still scroll the
     page. Without this the track swallows vertical drags near its edges. */
  touch-action: pan-y pinch-zoom;
  scrollbar-width: none;
}

.landing-carousel__slide {
  scroll-snap-align: center;
}
```

This is the whole gesture layer on touch. Swipe, fling, momentum, rubber-banding
at the ends and the platform's own snap physics all come from the browser, tuned
per-platform, for free. A hand-rolled transform slider has to reimplement each of
them and will be worse at all four.

It also keeps the accessibility story: a scroll container is focusable and
scrollable by assistive tech, and the slides stay in the DOM rather than being
unmounted, so find-in-page still works.

**Programmatic movement** is `track.scrollTo({ left, behavior })` — the tab
buttons and arrow keys both go through one `goTo(index)`.

### 2. Desktop drag is a shim over the same scroll

Pointer drag is the one thing scroll-snap does not give you: a mouse cannot
"swipe". A small `usePointerDrag` hook maps pointer movement onto `scrollLeft`:

- `pointerdown` → record origin, `setPointerCapture`.
- `pointermove` → `scrollLeft = origin - dx`. Only after a **6px threshold**, so
  a click on a slide is still a click.
- `pointerup` / `pointercancel` → release, then let snap settle.
- Suppress the click that follows a real drag (a `dragged` ref checked in the
  capture-phase click handler), or dragging across a link inside a slide
  activates it on release.

Mouse only — `event.pointerType === 'mouse'`. Touch already works natively and
intercepting it would replace good platform physics with worse ones.

`cursor: grab` / `grabbing`, and `user-select: none` while dragging.

### 3. Which slide is active

The active index has two sources now (the buttons, and the user's own scrolling)
and they must not fight.

Use an `IntersectionObserver` on the slides with the track as `root`, threshold
~0.6, and take the most-visible entry as active. Chosen over the `scrollend`
event because `scrollend` is still missing on older Safari, and over a debounced
`scroll` listener because the observer is what actually answers the question
being asked.

Feedback loop to avoid: `goTo()` scrolls → observer fires mid-flight → state
updates → a `useEffect` scrolls again. Fix by making `goTo` the only writer of
scroll position and having the observer update state only, never scroll.

### 4. ARIA: stay with tabs

APG offers two shapes — `tablist`/`tabpanel`, or a `region` with
`aria-roledescription="carousel"`. Keep tabs:

- Exactly one slide is visible at a time, which is what the tab pattern
  describes.
- It is what the current tests already assert, and those assertions are the
  behaviour worth protecting.
- Carousel semantics buy something only when slides auto-advance, and these do
  not.

So the track is `role="tabpanel"` with the slides inside it, each slide
`aria-hidden` when it is not the active one, and the button row stays a
`tablist`. The inactive slides being in the DOM but hidden from AT is the same
trade the panel-height fix already makes for the bodies.

### 5. Reduced motion

`goTo` passes `behavior: 'auto'` instead of `'smooth'` under
`prefers-reduced-motion: reduce`, and `scroll-snap-type` stays — snapping is not
motion, it is where things land. Read it with `matchMedia`, not a CSS-only
override, because the behaviour is chosen in JS.

### 6. Layout

The tab list moves from a column beside the panel to a row **above** it on all
widths. With slides now moving horizontally, a vertical list on the left reads as
a second, contradictory axis. This also removes the narrow-screen special case
where the pill row and the page competed for horizontal swipes.

Dots (not just labels) below the track on phone widths, where the labels are too
wide to sit in one row.

## Affected Areas

**Modified**

- `apps/web/src/components/landing/LandingFeatureCarousel.tsx` — track, slides,
  `goTo`, observer, drag hook wiring
- `apps/web/src/components/landing/LandingFeatureCarousel.test.tsx` — existing
  assertions stay; new ones for drag, snap sync, and reduced motion
- `apps/web/src/components/landing/WelcomeLanding.css` — track, slides, drag
  cursors, tab row above the panel, dots
- `implementation-plans/welcome-landing-page.md` — point its carousel section here

**New**

- `apps/web/src/components/landing/usePointerDrag.ts` (+ test) — the mouse-drag
  shim, kept separate because it is generic and independently testable

**Unchanged**

- `LandingFigure`, the figure filenames, `LANDING_SECTIONS`, the analytics enums.
  `landing feature opened` keeps firing from `goTo`, so swiping reports the same
  event clicking does — otherwise the metric silently under-counts on mobile.

## Verification

Worth stating plainly, because it shaped the design: **the preview pane cannot
verify any of this.** It runs `visibilityState: hidden` with zero animation
frames, so scroll events never dispatch and `scrollLeft` changes without
producing one. A listener attached by hand recorded zero hits across a 400→1200
scroll while debugging the scroll cue.

So:

- **Unit tests** carry the logic — `goTo` writes scroll position, the observer
  maps visibility to the active index, the drag threshold, the click
  suppression, reduced motion picking `auto`. jsdom has no layout, so these
  assert against `scrollTo` calls and dispatched events rather than geometry.
- **The author checks the feel** — swipe on a phone, drag on a desktop, and
  whether the snap is where it should be. That cannot be automated here and
  should not be claimed as verified.

## Checklist

- [ ] `usePointerDrag.ts` + test: threshold, capture, click suppression, mouse
      only, cancel path
- [ ] Track and slides in CSS, with `touch-action: pan-y pinch-zoom`
- [ ] `goTo(index)` as the single writer of scroll position; buttons and keys
      both route through it
- [ ] `IntersectionObserver` sync, observer never scrolls
- [ ] Tab row above the panel; dots at phone widths
- [ ] `aria-hidden` on inactive slides; existing tab assertions still pass
- [ ] Reduced motion picks `behavior: 'auto'`
- [ ] `landing feature opened` fires on swipe as well as click
- [ ] Full suite, typecheck, lint, `i18n:check`
- [ ] **Author:** swipe on a phone, drag on a desktop, confirm the feel
