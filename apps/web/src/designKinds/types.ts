import type { TFunction } from 'i18next';
import type { ComponentType } from 'react';
import type { ImportedCreasePatternFormat } from '../lib/creasePatternImport';
import type { NativeProjectDocumentKind } from '../lib/nativeProjectFile';
import type { AppStatus, WorkflowTarget } from '../lib/sampleProject';
import type { WorkspaceCapabilityId } from '../lib/workspaceCapabilities';
import type { EditingContext } from '../workspaces/editingContext';
import type { EngineId } from '../engines/engineHost';

/**
 * The authoring methods the Design workspace can hold.
 *
 * Aliased to {@link WorkflowTarget} rather than redeclared: that type is already
 * threaded through the store, the chooser, and the `.osf` writer, and two unions
 * with the same members would drift. The alias is the direction of travel — new
 * code should name `DesignKindId`, and `WorkflowTarget` can be retired once its
 * remaining call sites move.
 */
export type DesignKindId = WorkflowTarget;

/** Inputs the chooser needs to decide whether a kind can be started right now. */
export interface DesignKindAvailability {
  engineReady: boolean;
  status: AppStatus;
}

/**
 * Where a pane sits inside its design tab.
 *
 * Describes today's two Design layouts exactly (see `applyDesignLayout`), so the
 * descriptors can be checked against the layout they replace rather than against
 * an idealized one. Phase 4 is what consumes this to build the tab's Gridview.
 */
export type DesignPanePlacement =
  /** The design canvas itself. Exactly one per kind. */
  | { kind: 'primary' }
  /** A pane splitting off the primary, sized as a fraction of the tab. */
  | { kind: 'split'; direction: 'right'; initialFraction: number }
  /**
   * A tool pane docked to one side. Panes sharing a `group` are tabbed together;
   * `inactive` mirrors Dockview's flag for the ones that start unselected.
   */
  | { kind: 'side'; group: string; initialWidth?: number; inactive?: boolean };

/**
 * Localized copy is a **function of `t`**, not a key/default pair, and it is
 * implemented inside each kind's own module.
 *
 * `i18n:extract` builds the English catalogs by scanning for literal
 * `t('ns:key', 'English')` calls (see `apps/web/CLAUDE.md`), so a descriptor that
 * carried keys as data would make its strings invisible to the extractor and
 * orphan their translations. Putting the literal calls in the descriptor module
 * keeps the extractor working *and* keeps a third kind from needing an edit to a
 * shared switch — it brings its own copy with it.
 */
export type LocalizedCopy<T> = (t: TFunction) => T;

export interface DesignPaneSpec {
  /** Unique within the kind. Composed with the tab id to form a runtime pane id. */
  id: string;
  /** Pane title. See {@link LocalizedCopy} for why this is a function. */
  title: LocalizedCopy<string>;
  placement: DesignPanePlacement;
  /**
   * The editing context that applies while this pane owns input. Two panes of one
   * kind may differ — BP's tree and packing share a document and an undo stack
   * but expose different view-scoped commands.
   */
  editingContext: EditingContext;
}

/**
 * How a kind's document moves between an engine handle and text.
 *
 * One codec serves three jobs — saving to `.osf`, LRU eviction, and undo
 * snapshots — because they are the same operation. Both engines already
 * round-trip through their text format on every undo, so this is a description
 * of existing behavior rather than a new capability.
 *
 * Every method is handle-in / handle-out with no ambient state: the caller owns
 * which document is being operated on. That is what makes N documents possible.
 */
export interface DesignKindCodec {
  /** A fresh document, as picking this kind from the chooser produces. */
  create(): Promise<number>;
  /** Load serialized text into a new handle. Inverse of {@link serialize}. */
  hydrate(text: string): Promise<number>;
  /** Serialize a handle. Must round-trip losslessly through {@link hydrate}. */
  serialize(handle: number): Promise<string>;
  /** Release a handle. Safe to call on an already-freed handle. */
  free(handle: number): Promise<void>;
}

/** What a design needs to know about the Edit canvas it is merging into. */
export interface SendToEditRequest {
  /**
   * Grid divisions of the Edit crease pattern. Box-pleat scales its export so one
   * BP cell maps onto one Edit cell; TreeMaker ignores it.
   */
  editGridDivisions: number;
  /** The design's title, used for the merge label and filename. */
  title: string;
}

/** Crease-pattern text ready to hand to `importAddOristudioCpText`. */
export interface SendToEditPayload {
  text: string;
  format: ImportedCreasePatternFormat;
  /** Undo label for the merge. */
  label: string;
  filename: string;
}

/**
 * Which capabilities a kind claims or suppresses.
 *
 * Split into `owned` and `hidden` because the two are different questions.
 * `owned` is "this command only makes sense here", enforced for every *other*
 * context. `hidden` is "this command exists elsewhere but not here". Modelling
 * only the second would force each kind to re-list every other kind's commands.
 */
export interface DesignKindCapabilities {
  /** Visible only while this kind is being edited; hidden in every other context. */
  owned: readonly WorkspaceCapabilityId[];
  /** Additionally hidden while this kind is being edited. */
  hiddenIds: readonly WorkspaceCapabilityId[];
  /** Additionally hidden while this kind is being edited, matched by id prefix. */
  hiddenPrefixes: readonly string[];
}

export interface DesignKindChooserCopy {
  title: string;
  description: string;
}

export interface DesignKindChooser {
  /** Card title and blurb. See {@link LocalizedCopy}. */
  copy: LocalizedCopy<DesignKindChooserCopy>;
  Icon: ComponentType<{ size?: number }>;
  /** Order in the chooser; lower first. */
  order: number;
  isAvailable(input: DesignKindAvailability): boolean;
}

/**
 * Everything the app needs to know about one design authoring method.
 *
 * The point of this type is that adding a third method should be adding one
 * descriptor and nothing else. Any `if (kind === 'box-pleat')` left elsewhere in
 * the app is a field this interface is missing — see the stub-kind test in
 * `registry.test.ts`, which is the executable form of that claim.
 */
export interface DesignKindDescriptor {
  id: DesignKindId;
  /**
   * The engine backing this kind's handles.
   *
   * Named rather than implied, because engine and kind are not one-to-one: a
   * later kind may well be built on an existing engine, and the document
   * registry needs to know which documents a given engine's death invalidates.
   */
  engine: EngineId;
  /** Discriminator this kind's document carries in a `.osf` file. */
  osfKind: NativeProjectDocumentKind;
  /** Event property value. An enum, never a user-supplied string. */
  analyticsId: string;
  chooser: DesignKindChooser;
  panes: readonly DesignPaneSpec[];
  capabilities: DesignKindCapabilities;
  codec: DesignKindCodec;
  sendToEdit(handle: number, request: SendToEditRequest): Promise<SendToEditPayload>;
}
