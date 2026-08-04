import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  AlignJustify,
  BadgeAlert,
  BadgeCheck,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BoxSelect,
  ChartNoAxesCombined,
  ChartPie,
  ChevronDown,
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
  SquareDashed,
  StretchHorizontal,
  TextCursorInput,
  Trash2,
  Unlink,
  VenetianMask,
  Waves,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  ORISTUDIO_CP_ACTIONS,
  ORISTUDIO_CP_ACTION_GROUPS,
  cpActionsForGroup,
  type OristudioCpActionDefinition,
  type OristudioCpActionGroupDefinition,
  type OristudioCpActionId,
} from '../../lib/oristudioCpActions';
import type { OristudioCpLineColor } from '../../engine/oristudioCpTypes';
import { shortcutLabelForAction, type ShortcutOverrides } from '../../keyboard/shortcuts';
import { readJson, storageKey, writeJson, STORAGE_KEYS } from '../../lib/storage';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { useShortcutStore } from '../../store/shortcutStore';
import {
  cpActionLabel,
  cpActionRailLabel,
  cpActionTooltip,
  cpActionDisabledReason,
  cpGroupLabel,
  cpGroupRailLabel,
} from '../../i18n/cpVocab';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip';
import { ProtractorIcon } from '../ui/ProtractorIcon';
import { SolveFoldAnglesIcon } from '../ui/SolveFoldAnglesIcon';

/** A rail icon: any lucide icon, or a local component with the same props. */
type CpToolIcon = LucideIcon | typeof ProtractorIcon | typeof SolveFoldAnglesIcon;

const RAIL_GROUPS_STORAGE_KEY = storageKey(STORAGE_KEYS.cpToolRailGroups);

/** Which collapsible rail groups the user has opened, keyed by group id. */
function readRailGroupOpenState(): Record<string, boolean> {
  const stored = readJson<unknown>(RAIL_GROUPS_STORAGE_KEY, {});
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  return stored as Record<string, boolean>;
}

function writeRailGroupOpenState(groupId: string, open: boolean): void {
  writeJson(RAIL_GROUPS_STORAGE_KEY, { ...readRailGroupOpenState(), [groupId]: open });
}

interface CpToolRailProps {
  activeActionId: OristudioCpActionId | null;
  activeLineColor: OristudioCpLineColor;
  editable: boolean;
  onSelectAction: (action: OristudioCpActionDefinition) => void;
}

const LUCIDE_ICONS: Record<string, CpToolIcon> = {
  ProtractorIcon,
  SolveFoldAnglesIcon,
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
  SquareDashed,
  StretchHorizontal,
  TextCursorInput,
  Trash2,
  Unlink,
  VenetianMask,
  Waves,
  Wrench,
};

/** The size every rail icon is drawn at unless it needs an optical correction. */
const RAIL_ICON_SIZE = 20;

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
const RAIL_ICON_SIZES = new Map<CpToolIcon, number>([[SolveFoldAnglesIcon, 23]]);

const ICON_ALIASES: Record<string, string> = {
  angle: 'ProtractorIcon',
  'angle-solve': 'SolveFoldAnglesIcon',
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
) as Partial<Record<OristudioCpActionId, CpToolIcon>>;

export const CpToolRail = memo(function CpToolRail({
  activeActionId,
  activeLineColor,
  editable,
  onSelectAction,
}: CpToolRailProps) {
  const { t } = useTranslation();
  const shortcutOverrides = useShortcutStore((state) => state.overrides);

  return (
    <aside className="cp-tool-rail" aria-label={t('tools:cpRail.ariaLabel', 'Crease pattern tools')}>
      <div className="cp-tool-rail__groups">
        {ORISTUDIO_CP_ACTION_GROUPS.map((group) => {
          const actions = cpActionsForGroup(group.id).filter(
            (action) =>
              action.placement === 'left-rail' ||
              action.placement === 'left-rail-overflow'
          );
          if (actions.length === 0) return null;

          return (
            <CpToolRailGroup
              key={group.id}
              group={group}
              actions={actions}
              activeActionId={activeActionId}
              activeLineColor={activeLineColor}
              editable={editable}
              onSelectAction={onSelectAction}
              shortcutOverrides={shortcutOverrides}
            />
          );
        })}
      </div>
    </aside>
  );
});

function CpToolRailGroup({
  group,
  actions,
  activeActionId,
  activeLineColor,
  editable,
  onSelectAction,
  shortcutOverrides,
}: {
  group: OristudioCpActionGroupDefinition;
  actions: OristudioCpActionDefinition[];
  activeActionId: OristudioCpActionId | null;
  activeLineColor: OristudioCpLineColor;
  editable: boolean;
  onSelectAction: (action: OristudioCpActionDefinition) => void;
  shortcutOverrides: ShortcutOverrides;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(
    () => readRailGroupOpenState()[group.id] ?? group.collapsedByDefault !== true
  );
  const buttonsId = `cp-tool-rail-group-${group.id}`;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeRailGroupOpenState(group.id, next);
  };

  return (
    <section
      className="cp-tool-rail__group"
      aria-label={cpGroupLabel(t, group)}
      data-open={open || undefined}
    >
      <button
        type="button"
        className="cp-tool-rail__group-toggle"
        aria-expanded={open}
        aria-controls={buttonsId}
        onClick={toggle}
      >
        <span className="cp-tool-rail__group-label">{cpGroupRailLabel(t, group)}</span>
        <ChevronDown className="cp-tool-rail__group-chevron" size={10} aria-hidden="true" />
      </button>
      {open && (
        <div className="cp-tool-rail__buttons" id={buttonsId} data-group={group.id}>
          {actions.map((action) => (
            <CpToolButton
              key={action.id}
              action={action}
              editable={editable}
              isActive={
                action.kind === 'line-type'
                  ? activeLineColor === action.lineColor
                  : activeActionId === action.id
              }
              onSelectAction={onSelectAction}
              shortcutLabel={shortcutLabelForAction(action.id, shortcutOverrides)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const CpToolButton = memo(function CpToolButton({
  action,
  editable,
  isActive,
  onSelectAction,
  shortcutLabel,
}: {
  action: OristudioCpActionDefinition;
  editable: boolean;
  isActive: boolean;
  onSelectAction: (action: OristudioCpActionDefinition) => void;
  shortcutLabel?: string;
}) {
  const { t } = useTranslation();
  const Icon =
    action.kind === 'command'
      ? (CP_TOOL_ICON_BY_OPERATION[action.operationId] ?? CircleDashed)
      : (CP_TOOL_ICON_BY_ACTION[action.id] ?? CircleDashed);
  const orieditaGlyph =
    ORIEDITA_ICON_GLYPHS[action.upstreamAction] ??
    (action.kind === 'command' ? ORIEDITA_OPERATION_GLYPHS[action.operationId] : undefined);
  const available = editable && action.uiStatus === 'ready';
  const label = cpActionLabel(t, action);
  const railLabel = cpActionRailLabel(t, action);
  const statusLabel = commandStatusLabel(action, editable, t);
  const title = shortcutLabel
    ? `${label} (${shortcutLabel}) - ${statusLabel}`
    : `${label} - ${statusLabel}`;

  const button = (
    <button
      type="button"
      className="cp-tool-rail__button"
      aria-label={label}
      aria-disabled={!available}
      data-active={isActive || undefined}
      data-action-kind={action.kind}
      data-line-color={action.kind === 'line-type' ? action.lineColor : undefined}
      data-ui-status={action.uiStatus}
      onClick={() => {
        if (!available) return;
        onSelectAction(action);
      }}
    >
      {railLabel ? (
        <span className="cp-tool-rail__button-label" aria-hidden="true">
          {railLabel}
        </span>
      ) : orieditaGlyph ? (
        <span className="cp-tool-rail__oriedita-icon" aria-hidden="true">
          {orieditaGlyph}
        </span>
      ) : (
        <Icon size={RAIL_ICON_SIZES.get(Icon) ?? RAIL_ICON_SIZE} aria-hidden="true" />
      )}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{title}</TooltipContent>
    </Tooltip>
  );
});

function commandIcon(icon: string): CpToolIcon {
  const aliased = ICON_ALIASES[icon];
  const pascal = aliased ?? icon.split('-').map(capitalize).join('');
  return LUCIDE_ICONS[pascal] ?? CircleDashed;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function commandStatusLabel(
  action: OristudioCpActionDefinition,
  editable: boolean,
  t: TFunction
): string {
  if (!editable) return t('tools:cpRail.openEditableFirst', 'Open an editable crease pattern first');
  if (action.uiStatus === 'ready') return cpActionTooltip(t, action);
  return cpActionDisabledReason(t, action);
}
