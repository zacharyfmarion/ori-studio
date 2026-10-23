import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The session as the canvas reads it, without the worker: the flat sheet on
 * screen, nothing landed yet, every verb a spy. The canvas's wiring is the
 * subject — which surfaces mount and what each is handed — not the engine.
 */
const session = vi.hoisted(() => {
  const node = {
    status: "pending" as const,
    path: null,
    state: null,
    fingerprint: null,
    summary: null,
    report: null,
    refusal: null,
  };
  const surface = {
    cursor: node,
    cursorId: null,
    readOnly: false,
    pending: { status: "idle" as const },
    analysis: { status: "idle" as const },
    error: null,
    analyse: () =>
      Promise.resolve({ status: "unavailable", reason: "no-state" }),
    preview: () =>
      Promise.resolve({ status: "unavailable", reason: "no-state" }),
    commitStep: () =>
      Promise.resolve({ status: "unavailable", reason: "no-state" }),
    cancel: () => undefined,
    withState: () =>
      Promise.resolve({ status: "unavailable", reason: "no-state" }),
    withNode: () =>
      Promise.resolve({ status: "unavailable", reason: "no-state" }),
    withCursor: () =>
      Promise.resolve({ status: "unavailable", reason: "no-state" }),
    query: () =>
      Promise.resolve({ status: "unavailable", reason: "no-state" }),
    peek: () => null,
    resolveOrders: () =>
      Promise.resolve({ status: "unavailable", reason: "no-state" }),
    axiomRoots: () =>
      Promise.resolve({ status: "unavailable", reason: "no-state" }),
    retry: () => undefined,
  };
  const snapshot = {
    readOnly: false,
    cursor: null,
    sequence: null,
    sheet: node,
    nodes: new Map(),
    activePath: [],
    pending: { status: "idle" as const },
  };
  return { node, surface, snapshot };
});

vi.mock("../../../fold/session/useFoldSession", () => ({
  useFoldSession: () => session.surface,
  useFoldSessionState: (selector: (snapshot: unknown) => unknown) =>
    selector(session.snapshot),
  useFoldCursor: () => session.node,
  useFoldNode: () => null,
  useFoldNodeQuery: () => null,
  useFoldStateQuery: () => null,
}));

/** The model each render hands the tool window, the real window rendering it. */
const toolWindowModels = vi.hoisted(() => [] as unknown[]);
vi.mock("../FoldToolWindow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../FoldToolWindow")>();
  return {
    FoldToolWindow: (props: Parameters<typeof actual.FoldToolWindow>[0]) => {
      toolWindowModels.push(props.model);
      return actual.FoldToolWindow(props);
    },
  };
});

import { isFoldAltLatched, resetFoldAltLatch, setFoldAltLatched } from "../../../fold/canvas/foldAltLatch";
import { foldPaneDisplay, resetFoldPaneDisplay } from "../../../fold/canvas/foldPaneDisplay";
import { resetFoldToolFavorites, toggleFoldToolFavorite } from "../../../fold/tools/foldToolFavorites";
import { foldTools } from "../../../fold/tools/foldToolState";
import {
  clearHeldModifiers,
  readHeldModifiers,
  syncHeldModifiersFromEvent,
} from "../../../keyboard/heldModifiers";
import { PHONE_MEDIA_QUERY } from "../../../platform/phoneLayout";
import { TooltipProvider } from "../../ui/Tooltip";
import { FoldCanvas } from "./FoldCanvas";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <TooltipProvider delayDuration={0}>
        <FoldCanvas sendToEdit={<button type="button">Send to Edit</button>} />
      </TooltipProvider>,
    ),
  );
  return host;
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  foldTools().selectTool("valley");
  foldTools().selectLineMode("axiom-2");
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
  // The switches are the view's, shared with the step strip: put them back.
  resetFoldPaneDisplay();
  resetFoldToolFavorites();
});

describe("the Fold canvas", () => {
  it("mounts both panes and the toolbar with its display switches and the Send to Edit slot", () => {
    const canvas = mount();
    expect(canvas.querySelector('[data-fold-pane="folded"]')).not.toBeNull();
    expect(
      canvas.querySelector('[data-fold-pane="crease-pattern"]'),
    ).not.toBeNull();
    // The rail is the panel's, down its whole side (`FoldWorkspaceRail`).
    expect(canvas.querySelector('aside[aria-label="Fold tools"]')).toBeNull();
    // Both display switches start on; each is a toggle of its own.
    const toggle = (label: string) =>
      canvas.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(toggle("Step creases")?.hasAttribute("data-active")).toBe(true);
    expect(toggle("Flat creases")?.hasAttribute("data-active")).toBe(true);
    act(() => toggle("Flat creases")?.click());
    expect(toggle("Flat creases")?.hasAttribute("data-active")).toBe(false);
    expect(toggle("Step creases")?.hasAttribute("data-active")).toBe(true);
    // Flat creases and Spread layers are told apart at a glance: different icons.
    const glyph = (label: string) => toggle(label)?.querySelector("svg")?.innerHTML;
    expect(glyph("Flat creases")).not.toBe(glyph("Spread layers"));
    // The switches are shared: the step strip's cards read the same ones.
    expect(foldPaneDisplay()).toEqual({ stepCreases: true, precreases: false });
    expect(
      [...canvas.querySelectorAll("button")].some(
        (button) => button.textContent === "Send to Edit",
      ),
    ).toBe(true);
  });

  it("leads a phone’s bar with the tools and the pane switch, the display switches in its menu", async () => {
    const { PHONE_MEDIA_QUERY } = await import("../../../platform/phoneLayout");
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === PHONE_MEDIA_QUERY || query.includes("pointer: coarse"),
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    const canvas = mount();
    const bar = canvas.querySelector<HTMLElement>("[data-viewport-toolbar]");
    const names = [...(bar?.querySelectorAll("button") ?? [])].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    );
    // The starred tools, the one in hand pressed, then the pane the switch
    // shows next; the menu. The Tools pill is the header's, not the bar's.
    expect(names.slice(0, 5)).toEqual(["Valley fold", "Mountain fold", "Precrease", "Turn over", "Crease pattern"]);
    expect(names).not.toContain("Tools");
    expect(names).not.toContain("Step creases");
    expect(names).not.toContain("Flat creases");
    const button = (label: string) => bar?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button("Valley fold")?.hasAttribute("data-active")).toBe(true);
    expect(button("Mountain fold")?.hasAttribute("data-active")).toBe(false);
    // A favorite on the bar takes its tool in hand.
    act(() => button("Mountain fold")?.click());
    expect(foldTools().store.getState().tool).toBe("mountain");
    expect(button("Mountain fold")?.hasAttribute("data-active")).toBe(true);
    // A star in the sheet reaches the bar, in the user's order, up to its four.
    act(() => {
      toggleFoldToolFavorite("turn-over");
      toggleFoldToolFavorite("squash");
    });
    expect(button("Turn over")).toBeNull();
    expect(button("Squash fold")).not.toBeNull();
    act(() => toggleFoldToolFavorite("petal"));
    expect(button("Petal fold")).toBeNull();
    // One pane at a time, the folded form first; the switch shows the other.
    expect(canvas.querySelector('[data-fold-pane="crease-pattern"]')).toBeNull();
    act(() => button("Crease pattern")?.click());
    expect(canvas.querySelector('[data-fold-pane="crease-pattern"]')).not.toBeNull();
    expect(canvas.querySelector('[data-fold-pane="folded"]')).toBeNull();
    act(() => button("Folded")?.click());
  });

  it("shows a touch phone's free-point latch on the bar while it is on, and lets it go from there", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === PHONE_MEDIA_QUERY || query.includes("pointer: coarse"),
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    try {
      const canvas = mount();
      const latch = () => canvas.querySelector<HTMLButtonElement>("[data-fold-alt-latch-bar]");
      // Off, it is the sheet's alone.
      expect(latch()).toBeNull();
      act(() => setFoldAltLatched(true));
      expect(latch()?.getAttribute("aria-label")).toBe("Free point");
      expect(latch()?.getAttribute("aria-pressed")).toBe("true");
      // After the starred tools, in the last one's place, so the bar stays one row.
      const names = [...(canvas.querySelector("[data-viewport-toolbar]")?.querySelectorAll("button") ?? [])].map(
        (button) => button.getAttribute("aria-label"),
      );
      expect(names.slice(0, 5)).toEqual(["Valley fold", "Mountain fold", "Precrease", "Free point", "Crease pattern"]);
      act(() => latch()?.click());
      expect(isFoldAltLatched()).toBe(false);
      expect(latch()).toBeNull();
    } finally {
      resetFoldAltLatch();
    }
  });

  it("puts no step transport on the bar: a step is shown, never played", () => {
    const canvas = mount();
    expect(canvas.querySelector('[role="group"][aria-label="Step playback"]')).toBeNull();
    expect(canvas.querySelector('button[aria-label="Play step"]')).toBeNull();
  });

  it("reads the keys held off every pointer event over a pane, so a modifier whose key-up was missed lets go", () => {
    const canvas = mount();
    const pane = canvas.querySelector('[data-fold-pane="folded"]');
    if (!pane) throw new Error("no folded pane");
    const press = (type: string, altKey: boolean) =>
      act(() => {
        pane.dispatchEvent(new MouseEvent(type, { bubbles: true, altKey }));
      });
    for (const type of ["pointermove", "pointerdown", "pointerup"]) {
      // Alt down, its key-up landed in another window: held, as far as the app knows.
      syncHeldModifiersFromEvent({ ctrlKey: false, altKey: true, shiftKey: false, metaKey: false });
      press(type, false);
      expect(readHeldModifiers().alt, type).toBe(false);
      // Held for real: a press with it down says so.
      press(type, true);
      expect(readHeldModifiers().alt, type).toBe(true);
      clearHeldModifiers();
    }
  });

  it("puts no status chip over either pane: the tool window says what to click", () => {
    const canvas = mount();
    expect(canvas.querySelector('[data-fold-pane="folded"]')).not.toBeNull();
    expect(canvas.querySelector("[data-viewport-status-readout]")).toBeNull();
  });

  it("draws Unfold to step and Repeat in the tool window as any tool, on a phone and off one", () => {
    type Model = { title: string; footer: { commit: { label: string; disabled: boolean } } | null } | null;
    const shown = () => toolWindowModels.at(-1) as Model;
    try {
      for (const phone of [false, true]) {
        vi.stubGlobal(
          "matchMedia",
          vi.fn((query: string) => ({
            matches: phone && query === PHONE_MEDIA_QUERY,
            addEventListener: () => {},
            removeEventListener: () => {},
          })),
        );
        mount();
        act(() => foldTools().selectTool("unfold-to"));
        // The flat sheet on screen: nothing to return from, so nothing to commit.
        expect(shown()).toMatchObject({ title: "Unfold to step", footer: { commit: { label: "Unfold to step", disabled: true } } });
        act(() => foldTools().selectTool("repeat"));
        expect(shown()).toMatchObject({ title: "Repeat", footer: { commit: { label: "Repeat", disabled: true } } });
        // Put down, the tool they were taken up from is back in hand.
        act(() => {
          foldTools().putDown();
        });
        expect(foldTools().store.getState().tool).toBe("valley");
        act(() => root?.unmount());
        root = null;
        host?.remove();
        host = null;
      }
    } finally {
      foldTools().putDown();
    }
  });
});
