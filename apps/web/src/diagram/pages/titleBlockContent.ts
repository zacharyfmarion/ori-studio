/**
 * What the first page's title block shows (`implementation-plans/
 * diagram-title-block.md`, sections 4 and 5): which step gives the finished
 * model, and which gives the crease pattern, from what the document sets
 * (`DiagramDocument.titleBlockContent`).
 *
 * Each part is Auto, a step chosen, or none. Auto is the last step that can
 * give the part ({@link givesModel}, {@link givesPattern}), so turns, empty
 * steps, a newer build's locked steps and a link whose pattern draws no line
 * are passed over, and a diagram with no step linked to a crease pattern — in
 * Edit, or a Fold step's — has no pattern. A
 * chosen step that is gone — deleted, or now a newer build's — reads as
 * Auto; one that is there but can no longer give its part, its picture
 * removed or its link replaced, gives nothing, which the Pages view says. A
 * part only a newer build reads is not in the content here, so it is Auto
 * too.
 *
 * That a part unsaid is Auto is fixed for good; what Auto finds is a look
 * (`diagram-document-evolution.md`, class (b)): a change to it moves no step,
 * though it changes the picture a saved block shows.
 *
 * The pattern is drawn from its step's stored thumbnail, as a scene for the
 * shared painter ({@link patternScene}): a linked region's, or a Fold step's
 * state's, every crease made so far; the model in front of it, or in
 * the pattern's place where none is drawn ({@link modelRoom}). The words
 * the block prints of its own are read here too ({@link titleBlockLook}).
 * What prints nothing where it would show, the Pages view marks
 * ({@link missingTitleBlockParts}). Pure.
 */
import type { SheetStrokeRole, SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import type { PaperLineItem, PaperLineRole, PaperScene } from '../../lib/paper/paperScene';
import type { PageBox } from './pagePlacement';
import { DESCENT, type LayoutTitleBlock, type TitleBlockLook } from './titleBlockColumn';
import type { PictureAlign, TitleBlockGeometry } from './titleBlockGeometry';
import {
  isLockedStep,
  stepById,
  stepNumbers,
  stepsOf,
  titleBlockArtSizes,
  titleBlockStepCount,
  type DiagramCpSource,
  type DiagramDocument,
  type DiagramFoldStepSource,
  type DiagramStep,
  type DiagramTitleBlockSource,
} from '../document/diagramDocument';

/**
 * A link whose stored thumbnail is a crease pattern the block can draw: a
 * region of Edit's pattern, or a Fold step's state — a run's last step's
 * (`lastFoldStepOf`) — as its Crease pattern picture draws it. A References
 * card's sheet is not the model's pattern.
 */
export type TitleBlockPatternSource = DiagramCpSource | DiagramFoldStepSource;

/** Where a part of the title block comes from: Auto, the step chosen, or none. */
export type TitleBlockPartFrom = 'auto' | 'step' | 'none';

/** The step a part of the title block comes from. */
export interface TitleBlockPart {
  from: TitleBlockPartFrom;
  /** Auto's find or the step chosen; null for none, and where Auto finds no step. */
  step: DiagramStep | null;
  /** That step's number, as the pages print it (`stepNumbers`); null with no step. */
  number: number | null;
}

/** What the title block shows. */
export interface ResolvedTitleBlock {
  /** The step whose picture is the finished model. */
  model: TitleBlockPart;
  /**
   * The step whose link gives the crease pattern, and the pattern as the
   * painter draws it: its stored thumbnail's lines ({@link patternScene}),
   * null where it gives none or has no line to draw.
   */
  pattern: TitleBlockPart & { scene: PaperScene | null };
  /** The band's colour its author chose (`DiagramTitleBlockContent.bandColor`); none, and it follows the paper's. */
  bandColor?: string;
}

/** Whether a step can give the block's model: one of this build's, with a picture. */
export function givesModel(step: DiagramStep): boolean {
  return !isLockedStep(step) && step.picture !== null;
}

/**
 * Whether a step can give the block's crease pattern: one of this build's
 * linked to a crease pattern — Edit's, or a Fold step's
 * ({@link TitleBlockPatternSource}) — whatever it is shown as, whose stored
 * lines draw something ({@link drawsPattern}).
 */
export function givesPattern(step: DiagramStep): step is DiagramStep & { source: TitleBlockPatternSource } {
  const { source } = step;
  return !isLockedStep(step) && (source?.kind === 'cp' || source?.kind === 'fold-step') && drawsPattern(source);
}

/** The step Auto finds for the model: the last that can give it; null where none can. */
export function autoModelStep(document: DiagramDocument): DiagramStep | null {
  return lastStep(document, givesModel);
}

/** The step Auto finds for the crease pattern: the last linked to one, in Edit or Fold; null where no step is. */
export function autoPatternStep(document: DiagramDocument): DiagramStep | null {
  return lastStep(document, givesPattern);
}

function lastStep(document: DiagramDocument, gives: (step: DiagramStep) => boolean): DiagramStep | null {
  const steps = stepsOf(document);
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (gives(steps[index]!)) return steps[index]!;
  }
  return null;
}

/** What the first page's title block shows: each part's step, the pattern's lines, and the band's colour where chosen. */
export function resolveTitleBlock(document: DiagramDocument): ResolvedTitleBlock {
  const content = document.titleBlockContent;
  const numbers = stepNumbers(document);
  const model = resolvePart(document, numbers, content?.model, autoModelStep);
  const pattern = resolvePart(document, numbers, content?.pattern, autoPatternStep);
  const scene = pattern.step && givesPattern(pattern.step) ? patternScene(pattern.step.source) : null;
  return { model, pattern: { ...pattern, scene }, ...(content?.bandColor ? { bandColor: content.bandColor } : {}) };
}

function resolvePart(
  document: DiagramDocument,
  numbers: ReadonlyMap<string, number>,
  source: DiagramTitleBlockSource | undefined,
  auto: (document: DiagramDocument) => DiagramStep | null
): TitleBlockPart {
  const part = (from: TitleBlockPartFrom, step: DiagramStep | null): TitleBlockPart => ({
    from,
    step,
    number: step ? (numbers.get(step.id) ?? null) : null,
  });
  if (source?.kind === 'none') return part('none', null);
  const chosen = source?.kind === 'step' ? stepById(document, source.stepId) : null;
  if (chosen && !isLockedStep(chosen)) return part('step', chosen);
  return part('auto', auto(document));
}

type PatternRoles = Readonly<Record<SheetStrokeRole, PaperLineRole | null>>;

/**
 * The pen each of a linked region's thumbnail lines is drawn in (T-14 A): the
 * pattern's own — its folds in the fold pens, solid, its edge in the edge pen,
 * a crease with no direction yet in the aux pen where the style shows aux
 * lines — and an aux line, Edit's construction line, not at all.
 */
const PATTERN_ROLES: PatternRoles = {
  edge: 'edge',
  mountain: 'mountain',
  valley: 'valley',
  unassigned: 'aux',
  aux: null,
};

/**
 * A Fold step's thumbnail (`foldStateFrame`'s pattern) in the same pens, but
 * for its aux lines: there they are creases — a precrease, or a pinch's mark,
 * lying flat — which the step's Crease pattern picture draws in the aux pen
 * (`creasePatternPaperScene`), and so does the block.
 */
const FOLD_PATTERN_ROLES: PatternRoles = { ...PATTERN_ROLES, aux: 'aux' };

/** What a link's thumbnail is, line by line: an aux line is Edit's construction line, and a Fold state's flat crease. */
function patternRoles(kind: TitleBlockPatternSource['kind']): PatternRoles {
  return kind === 'fold-step' ? FOLD_PATTERN_ROLES : PATTERN_ROLES;
}

/** A link's stored pattern, as the block reads it: its thumbnail, and what kind of link it is. */
export type TitleBlockPatternThumbnail = Pick<TitleBlockPatternSource, 'kind' | 'thumbnail'>;

/**
 * A link's stored thumbnail as a scene for the shared painter
 * (`paperSceneSvgBody`): its lines in their roles, in its own units, its
 * bounds its box. No paper is filled, so the pattern sits on the page and the
 * model in front covers it with its own. Null where it has no line to draw.
 */
export function patternScene({ kind, thumbnail }: TitleBlockPatternThumbnail): PaperScene | null {
  const roles = patternRoles(kind);
  const box = thumbnailBox(thumbnail);
  const items = thumbnail.strokes.flatMap((stroke): PaperLineItem[] => {
    const role = roles[stroke.role];
    return role
      ? [{ kind: 'line', role, a: [stroke.x1, stroke.y1], b: [stroke.x2, stroke.y2], onBoundary: [false, false], hidden: false }]
      : [];
  });
  if (!box || items.length === 0) return null;
  const { minX, minY, width, height } = box;
  return { bounds: { minX, minY, maxX: minX + width, maxY: minY + height }, sheet: Math.max(width, height), items };
}

/**
 * Whether a link's thumbnail has a line the block draws, as
 * {@link patternScene} would: the one answer to "is there a pattern" for the
 * page, the Pages view's overlay and the Page pane's choices. A capture that
 * found no line, or a region with only aux lines, has none.
 */
export function drawsPattern({ kind, thumbnail }: TitleBlockPatternThumbnail): boolean {
  const roles = patternRoles(kind);
  return thumbnailBox(thumbnail) !== null && thumbnail.strokes.some((stroke) => roles[stroke.role] !== null);
}

/** A thumbnail's view box, null where it has no size to fit. */
function thumbnailBox(thumbnail: SheetThumbnail): { minX: number; minY: number; width: number; height: number } | null {
  const [minX = 0, minY = 0, width = 0, height = 0] = thumbnail.viewBox.trim().split(/[\s,]+/).map(Number);
  const sheet = Math.max(width, height);
  return sheet > 0 && Number.isFinite(sheet) ? { minX, minY, width, height } : null;
}

/**
 * What the block prints of its own, as it prints it (`titleBlockColumn.ts`):
 * the subtitle and the credits' labels in capitals, each credit's value — the
 * live step count as the number the last numbered step prints — the note,
 * and the art's sizes. One answer for the layout and for the fonts it loads.
 */
export function titleBlockLook(document: DiagramDocument): TitleBlockLook {
  const content = document.titleBlockContent;
  const count = titleBlockStepCount(document);
  return {
    subtitle: printedCapitals(content?.subtitle ?? ''),
    credits: (content?.credits ?? []).map(({ label, value }) => ({
      label: printedCapitals(label),
      value: typeof value === 'string' ? value : String(count),
    })),
    note: content?.note ?? '',
    sizes: titleBlockArtSizes(content),
  };
}

/** Upper case as the page prints it, the same on every machine: Unicode's own mapping, not the reader's locale; CJK unchanged. */
function printedCapitals(text: string): string {
  return text.toUpperCase();
}

/** Where the block's model is drawn: its box, and where in the box its picture stands (`wholePicture`). */
export interface ModelRoom {
  box: PageBox;
  align: PictureAlign;
}

/**
 * Where the block's model stands: on the pattern's lower-left corner, its
 * picture set so that it covers the corner (`TitleBlockGeometry.modelAlign`);
 * or, where no pattern is drawn, at its own size in the pattern's place, on
 * the band's right and the foot of its share (`artH`: the block its words
 * grew stands taller under it), its picture at the box's bottom right.
 */
export function modelRoom(geometry: TitleBlockGeometry, content: ResolvedTitleBlock): ModelRoom {
  const { block, artH, model, modelAlign } = geometry;
  if (content.pattern.scene) return { box: model, align: modelAlign };
  return { box: { ...model, x: block.x + block.w - model.w, y: block.y + artH - model.h }, align: { x: 1, y: 1 } };
}

/** A part of the title block that prints nothing where it would show, and why. */
export interface MissingTitleBlockPart {
  /**
   * The pattern or the model; or credits cut for want of room. A note cut for want of room is not marked: the block
   * grows for it, and past half the page its end is cut with "…"; nor is an empty title, which prints nothing (Zach,
   * 2026-10-15).
   */
  part: 'pattern' | 'model' | 'credits';
  /** The step that cannot give it; null where Auto finds none, and for the rest. */
  step: DiagramStep | null;
  /** That step's number, as the pages print it. */
  number: number | null;
}

/** A room of the block where what would print there prints nothing ({@link missingTitleBlockParts}). */
export interface TitleBlockPlaceholder {
  /**
   * The pattern's square — the model's room too where no pattern is drawn; the
   * model's box; and where the column is cut.
   */
  room: 'square' | 'model' | 'cut';
  /** One for each mark. */
  key: string;
  /**
   * Where it is marked: the room, or for the square, what a model drawn in it leaves free ({@link squareMark}); for
   * a cut, the strip under the block's foot its tag hangs in ({@link cutMark}).
   */
  box: PageBox;
  /** What prints nothing there, in the order it would be drawn. */
  missing: MissingTitleBlockPart[];
}

/** The least room across, in mm, a mark's words are set in: two or three lines of them on the Pages view. */
const MARK_ROOM_MM = 10;
/** How tall the strip under the block's foot is where a cut's tag hangs, mm: a line of the Pages view's words. */
const CUT_TAG_MM = 5;

/**
 * What of the block prints nothing where it would show, room by room: where
 * the credits are cut; the pattern and the model where they are Auto or a
 * step, and no step gives them — a part set to none is the author's, and is
 * not missing, nor is an empty note or a credit with no value, which are
 * simply not drawn, nor an empty title, which prints nothing (Zach,
 * 2026-10-15). The pattern and a model with no pattern in front of it would
 * print in one square, which is one room; so no two rooms overlap.
 * `drawnModel` is where the model is drawn, null where it is not
 * (`wholePictureRoom`), which the square's mark keeps clear of. For the Pages
 * view's overlay, never the page.
 */
export function missingTitleBlockParts(
  block: LayoutTitleBlock,
  content: ResolvedTitleBlock,
  drawnModel: PageBox | null
): TitleBlockPlaceholder[] {
  const { geometry } = block;
  const { model, pattern } = content;
  const missing = ({ step, number }: TitleBlockPart, part: MissingTitleBlockPart['part']) => ({ part, step, number });
  const square: MissingTitleBlockPart[] = [];
  const front: MissingTitleBlockPart[] = [];
  if (pattern.from !== 'none' && !pattern.scene) square.push(missing(pattern, 'pattern'));
  if (model.from !== 'none' && !model.step?.picture) (pattern.scene ? front : square).push(missing(model, 'model'));
  const cut = cutMark(block);
  return [
    ...(cut ? [cut] : []),
    ...(square.length > 0 ? [{ room: 'square' as const, key: 'square', box: squareMark(block, drawnModel), missing: square }] : []),
    ...(front.length > 0 ? [{ room: 'model' as const, key: 'model', box: geometry.model, missing: front }] : []),
  ];
}

/**
 * Where credits are left out for want of room — past half the page, or in a
 * grid's rows — marked by a tag hanging under the block's foot at the
 * column's end, over nothing the block prints, whatever the paper. A note's
 * end cut with "…" is not marked (Zach, 2026-10-15).
 */
function cutMark(block: LayoutTitleBlock): TitleBlockPlaceholder | null {
  const { column } = block.geometry;
  const { credits } = block;
  if (!credits || credits.cut === 0) return null;
  const missing: MissingTitleBlockPart[] = [{ part: 'credits', step: null, number: null }];
  return { room: 'cut', key: 'cut', box: { x: column.x, y: column.y + column.h, w: column.w, h: CUT_TAG_MM }, missing };
}

/**
 * Where the pattern's square is marked, clear of a model drawn in it
 * (`inSquare`): the square, less the model — the strip it leaves above
 * itself or beside itself, whichever is larger — or, where it leaves no room
 * for words, the column under all it prints, left of the model; the square itself
 * where neither has room.
 */
function squareMark(block: LayoutTitleBlock, inSquare: PageBox | null): PageBox {
  const { pattern: square, column } = block.geometry;
  if (!inSquare) return square;
  const above = { ...square, h: Math.max(0, inSquare.y - square.y) };
  const beside = { ...square, w: Math.max(0, inSquare.x - square.x) };
  const strip = above.w * above.h >= beside.w * beside.h ? above : beside;
  if (Math.min(strip.w, strip.h) >= MARK_ROOM_MM) return strip;
  const top = columnFoot(block);
  const under = leftOf({ x: column.x, y: top, w: column.w, h: column.y + column.h - top }, inSquare);
  return Math.min(under.w, under.h) >= MARK_ROOM_MM ? under : square;
}

/** `box`, ending where `other` begins where the two meet: what of it stands left of `other`. */
function leftOf(box: PageBox, other: PageBox | null): PageBox {
  const meet = other && other.y < box.y + box.h && other.y + other.h > box.y && other.x < box.x + box.w;
  return meet ? { ...box, w: Math.max(0, other.x - box.x) } : box;
}

/** How far down the column what it prints reaches: the band, the credits and the note. */
function columnFoot(block: LayoutTitleBlock): number {
  const { band, credits, note } = block;
  const feet = [band.y + band.h];
  const lastRow = credits?.columns.at(-1);
  if (lastRow && credits) feet.push(lastRow.valueBaseline + DESCENT * credits.valueSizeMm);
  if (note && note.lines.length > 0) feet.push(note.firstBaseline + (note.lines.length - 1) * note.leadingMm + DESCENT * note.sizeMm);
  return Math.max(...feet);
}

