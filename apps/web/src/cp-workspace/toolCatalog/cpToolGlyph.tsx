/**
 * What a crease-pattern tool looks like, wherever it is drawn.
 *
 * Two surfaces render the same 56 tools — the rail's icon grid and the touch
 * picker's labelled list — and a tool that draws one glyph in the rail and a
 * different one in the picker is worse than either. So the tables live here and
 * both call {@link CpToolGlyph}, rather than the rail owning them and the picker
 * re-deriving something close.
 */
import {
  AlignJustify,
  BadgeAlert,
  BadgeCheck,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BoxSelect,
  ChartNoAxesCombined,
  ChartPie,
  Circle,
  CircleDashed,
  CircleDot,
  CircleDotDashed,
  CircleEllipsis,
  CirclePlus,
  CircleSlash,
  CircleX,
  Combine,
  Copy,
  CopyPlus,
  CornerDownLeft,
  Divide,
  Download,
  DraftingCompass,
  Eraser,
  FileCog,
  FileInput,
  FileOutput,
  FileSearch,
  FlipHorizontal,
  FoldHorizontal,
  GitBranch,
  Hand,
  Hexagon,
  Image,
  Lasso,
  LassoSelect,
  Layers,
  ListOrdered,
  ListPlus,
  ListRestart,
  Mountain,
  MousePointer2,
  MousePointerClick,
  Move,
  Network,
  Paintbrush,
  Palette,
  PenLine,
  PenTool,
  RefreshCw,
  Repeat,
  Repeat2,
  Replace,
  Ruler,
  RulerDimensionLine,
  Scan,
  ScanLine,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  SkipForward,
  Sparkles,
  Split,
  Square,
  SquareDashed,
  StretchHorizontal,
  Target,
  TextCursorInput,
  Trash2,
  Unlink,
  VenetianMask,
  Waves,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ORISTUDIO_CP_ACTIONS, type OristudioCpActionDefinition } from '../../lib/oristudioCpActions';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { cpActionRailLabel } from '../../i18n/cpVocab';
import { ProtractorIcon } from '../../components/ui/ProtractorIcon';
import { PropagateFoldAnglesIcon } from '../../components/ui/PropagateFoldAnglesIcon';
import { SolveFoldAnglesIcon } from '../../components/ui/SolveFoldAnglesIcon';

/** A tool icon: any lucide icon, or a local component with the same props. */
export type CpToolIcon =
  | LucideIcon
  | typeof ProtractorIcon
  | typeof SolveFoldAnglesIcon
  | typeof PropagateFoldAnglesIcon;

const LUCIDE_ICONS: Record<string, CpToolIcon> = {
  ProtractorIcon,
  SolveFoldAnglesIcon,
  PropagateFoldAnglesIcon,
  AlignJustify,
  BadgeAlert,
  BadgeCheck,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BoxSelect,
  ChartNoAxesCombined,
  ChartPie,
  Circle,
  CircleDashed,
  CircleDot,
  CircleDotDashed,
  CircleEllipsis,
  CirclePlus,
  CircleSlash,
  CircleX,
  Combine,
  Copy,
  CopyPlus,
  CornerDownLeft,
  Divide,
  Download,
  DraftingCompass,
  Eraser,
  FileCog,
  FileInput,
  FileOutput,
  FileSearch,
  FlipHorizontal,
  FoldHorizontal,
  GitBranch,
  Hand,
  Hexagon,
  Image,
  Lasso,
  LassoSelect,
  Layers,
  ListOrdered,
  ListPlus,
  ListRestart,
  Mountain,
  MousePointer2,
  MousePointerClick,
  Move,
  Network,
  Paintbrush,
  Palette,
  PenLine,
  PenTool,
  RefreshCw,
  Repeat,
  Repeat2,
  Replace,
  Ruler,
  RulerDimensionLine,
  Scan,
  ScanLine,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  SkipForward,
  Sparkles,
  Split,
  Square,
  SquareDashed,
  StretchHorizontal,
  Target,
  TextCursorInput,
  Trash2,
  Unlink,
  VenetianMask,
  Waves,
  Wrench,
};

/** The size every tool icon is drawn at unless it needs an optical correction. */
export const CP_TOOL_ICON_SIZE = 20;

/**
 * Icons that need a different box to carry the same visual weight.
 *
 * Lucide's glyphs are drawn to fill a square, so one size suits all of them. A
 * local icon whose artwork is a different shape does not match at the same
 * number: {@link SolveFoldAnglesIcon} is wide and short, so even filling its
 * viewBox it reads lighter than the blockier glyphs beside it.
 *
 * Keyed by the component rather than by name, so an icon that is never rendered
 * here cannot leave a stale string behind.
 */
const CP_TOOL_ICON_SIZES = new Map<CpToolIcon, number>([
  [SolveFoldAnglesIcon, 23],
  // The bulb is height-bound where its neighbour is width-bound, so it needs
  // the opposite correction to sit at the same visual weight in the slot.
  [PropagateFoldAnglesIcon, 21],
]);

const ICON_ALIASES: Record<string, string> = {
  angle: 'ProtractorIcon',
  'angle-solve': 'SolveFoldAnglesIcon',
  'angle-propagate': 'PropagateFoldAnglesIcon',
  compass: 'DraftingCompass',
  divide: 'Divide',
  frame: 'Scan',
  mountain: 'Mountain',
  origami: 'Layers',
  split: 'Split',
};

const ORIEDITA_ICON_GLYPHS: Partial<Record<string, string>> = {
  angleBisectorAction: '\uE006',
  axiom5Action: '\uE076',
  axiom7Action: '\uE078',
  // Sits between `symmetricDrawAction` (E009) and `doubleSymmetricDrawAction`
  // (E010) in upstream's `icons.properties`, exactly as the three tools sit
  // together in Oriedita's drawing tab. Missing until now only because the tool
  // was hidden from the rail and nothing rendered an icon for it.
  continuousSymmetricDrawAction: '\uE00A',
  copy2p2pAction: '\uE064',
  copyAction: '\uE063',
  deg1Action: '\uE04A',
  deg2Action: '\uE04C',
  deg3Action: '\uE04D',
  del_lAction: '\uE06B',
  del_l_XAction: '\uE06C',
  del_l_typeAction: '\uE013',
  doubleSymmetricDrawAction: '\uE010',
  drawBlintzAction: '\uE090',
  drawBirdBaseAction: '\uE093',
  drawCreaseFreeAction: '\uE000',
  drawCreaseRestrictedAction: '\uE001',
  drawDoveBaseAction: '\uE092',
  drawFishBaseAction: '\uE091',
  drawFrogBaseAction: '\uE094',
  drawLineSegmentInternalDivisionRatioAction: '\uE044',
  fishBoneDrawAction: '\uE00F',
  fixInaccurateAction: '\uE089',
  foldableLineDrawAction: '\uE00D',
  foldableLinePlusGridInputAction: '\uE00D',
  in_L_col_changeAction: '\uE01D',
  lengthenCreaseAction: '\uE004',
  lengthenCrease2Action: '\uE005',
  move2p2pAction: '\uE062',
  moveAction: '\uE061',
  on_L_col_changeAction: '\uE01E',
  perpendicularDrawAction: '\uE008',
  regularPolygonAction: '\uE04F',
  replace_lineAction: '\uE017',
  selectAction: '\uE05D',
  selectLassoAction: '\uE07A',
  select_lXAction: '\uE069',
  select_polygonAction: '\uE06D',
  senbun_b_nyuryokuAction: '\uE011',
  senbun_henkan2Action: '\uE01B',
  senbun_henkanAction: '\uE01C',
  senbun_yoke_henkanAction: '\uE01C',
  symmetricDrawAction: '\uE009',
  toAuxAction: '\uE01A',
  toEdgeAction: '\uE019',
  toMountainAction: '\uE017',
  toValleyAction: '\uE018',
  trimBranchesAction: '\uE016',
  unselectAction: '\uE05F',
  unselectLassoAction: '\uE07B',
  unselect_lXAction: '\uE06A',
  unselect_polygonAction: '\uE06E',
  v_del_allAction: '\uE022',
  v_del_all_ccAction: '\uE023',
  v_del_ccAction: '\uE021',
  vertexAddAction: '\uE01F',
  vertexDeleteAction: '\uE020',
  voronoiAction: '\uE002',
};

const ORIEDITA_OPERATION_GLYPHS: Partial<Record<OristudioCpOperationId, string>> = {
  Axiom5: '\uE076',
  Axiom7: '\uE078',
  CreaseCopy: '\uE063',
  CreaseCopy4p: '\uE064',
  CreaseDeleteIntersecting: '\uE06C',
  CreaseDeleteOverlapping: '\uE06B',
  CreaseMove: '\uE061',
  CreaseMove4p: '\uE062',
  CreaseSelect: '\uE05D',
  CreaseUnselect: '\uE05F',
  DeleteExtraVertices: '\uE022',
  DeletePoint: '\uE020',
  DoubleSymmetricDraw: '\uE010',
  DrawBlintz: '\uE090',
  DrawBirdBase: '\uE093',
  DrawCreaseAngleRestricted: '\uE04A',
  DrawCreaseAngleRestricted5: '\uE04C',
  DrawCreaseFree: '\uE000',
  DrawCreaseRestricted: '\uE001',
  DrawDoveBase: '\uE092',
  DrawFishBase: '\uE091',
  DrawFrogBase: '\uE094',
  FishBoneDraw: '\uE00F',
  FoldableLineDraw: '\uE00D',
  FoldableLineInput: '\uE00D',
  Inward: '\uE007',
  LengthenCrease: '\uE004',
  LengthenCreaseSameColor: '\uE005',
  LineSegmentDivision: '\uE011',
  LineSegmentRatioSet: '\uE044',
  ParallelDraw: '\uE00B',
  PerpendicularDraw: '\uE008',
  PolygonSetNoCorners: '\uE04F',
  SelectLasso: '\uE07A',
  SelectLineIntersecting: '\uE069',
  SelectPolygon: '\uE06D',
  SquareBisector: '\uE006',
  SymmetricDraw: '\uE009',
  UnselectLasso: '\uE07B',
  UnselectLineIntersecting: '\uE06A',
  UnselectPolygon: '\uE06E',
  VertexDeleteOnCrease: '\uE021',
  VertexMakeAngularlyFlatFoldable: '\uE003',
  VoronoiCreate: '\uE002',
};

const CP_TOOL_ICON_BY_OPERATION = Object.fromEntries(
  ORISTUDIO_CP_ACTIONS.filter((action) => action.kind === 'command').map((action) => [
    action.operationId,
    commandIcon(action.icon),
  ])
) as Partial<Record<OristudioCpOperationId, CpToolIcon>>;

const CP_TOOL_ICON_BY_ACTION = Object.fromEntries(
  ORISTUDIO_CP_ACTIONS.map((action) => [action.id, commandIcon(action.icon)])
) as Partial<Record<string, CpToolIcon>>;

/**
 * One tool's mark.
 *
 * `railLabel` first: four line types are two characters wide and read better as
 * `M V E A` than as any icon. Then the Oriedita glyph, because an origami tool
 * ported from Oriedita should look like the one the user already knows. Lucide
 * is the fallback for everything Oriedita has no glyph for.
 */
export function CpToolGlyph({
  action,
  glyphOperationId,
  size = CP_TOOL_ICON_SIZE,
}: {
  action: OristudioCpActionDefinition;
  /**
   * The resolved operation to draw, when this is the active tool; else null. A
   * merged tool (Extend Line, Divided Line) is one button over two kernel
   * operations, and draws the variant its mode currently names — so the mode is
   * readable without opening the context panel.
   */
  glyphOperationId?: OristudioCpOperationId | null;
  size?: number;
}) {
  const { t } = useTranslation();
  // Localized, not `action.railLabel`: `M V E A` are initials of Mountain,
  // Valley, Edge and Auxiliary, and a locale whose words start with other
  // letters gets other initials.
  const railLabel = cpActionRailLabel(t, action);
  if (railLabel) {
    return (
      <span className="cp-tool-rail__button-label" aria-hidden="true">
        {railLabel}
      </span>
    );
  }

  const glyph = cpToolOrieditaGlyph(action, glyphOperationId ?? null);
  if (glyph) {
    return (
      <span className="cp-tool-rail__oriedita-icon" aria-hidden="true">
        {glyph}
      </span>
    );
  }

  // Read from the table inline rather than through `cpToolLucideIcon`:
  // `react-hooks/static-components` reads any *call* that yields a component as
  // one built during render, and remounts every frame is exactly what that rule
  // is there to prevent. A table lookup is not that, and it can see the
  // difference.
  const Icon =
    (action.kind === 'command'
      ? CP_TOOL_ICON_BY_OPERATION[action.operationId]
      : CP_TOOL_ICON_BY_ACTION[action.id]) ?? CircleDashed;
  return <Icon size={CP_TOOL_ICON_SIZES.get(Icon) ?? size} aria-hidden="true" />;
}

function cpToolOrieditaGlyph(
  action: OristudioCpActionDefinition,
  glyphOperationId: OristudioCpOperationId | null
): string | undefined {
  return (
    (glyphOperationId ? ORIEDITA_OPERATION_GLYPHS[glyphOperationId] : undefined) ??
    ORIEDITA_ICON_GLYPHS[action.upstreamAction] ??
    (action.kind === 'command' ? ORIEDITA_OPERATION_GLYPHS[action.operationId] : undefined)
  );
}

function cpToolLucideIcon(action: OristudioCpActionDefinition): CpToolIcon {
  return (
    (action.kind === 'command'
      ? CP_TOOL_ICON_BY_OPERATION[action.operationId]
      : CP_TOOL_ICON_BY_ACTION[action.id]) ?? CircleDashed
  );
}

/**
 * What {@link CpToolGlyph} would draw, as a comparable key.
 *
 * Exported for the test that asserts no two rail tools are indistinguishable —
 * the raw `icon` field collides six ways, but most of those pairs draw different
 * Oriedita glyphs and only what is *rendered* can confuse anyone.
 */
export function cpToolGlyphKey(action: OristudioCpActionDefinition): string {
  if (action.railLabel) return `text:${action.railLabel}`;
  const glyph = cpToolOrieditaGlyph(action, null);
  if (glyph) return `oriedita:${glyph}`;
  const Icon = cpToolLucideIcon(action);
  const named = Icon as { displayName?: string; name?: string };
  return `lucide:${named.displayName ?? named.name ?? 'unknown'}`;
}

function commandIcon(icon: string): CpToolIcon {
  const aliased = ICON_ALIASES[icon];
  const pascal = aliased ?? icon.split('-').map(capitalize).join('');
  return LUCIDE_ICONS[pascal] ?? CircleDashed;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}
