/**
 * Which crease-pattern tools the rail offers, in which groups.
 *
 * One list, read by both surfaces that draw it — the rail's icon grid and the
 * touch picker's labelled sheet. The picker exists to *name* what the rail
 * shows, so a picker that computed its own filter could quietly stop naming
 * some of it.
 */
import {
  ORISTUDIO_CP_ACTION_GROUPS,
  cpActionsForGroup,
  type OristudioCpActionDefinition,
  type OristudioCpActionGroupDefinition,
} from '../../lib/oristudioCpActions';

export interface CpRailGroup {
  group: OristudioCpActionGroupDefinition;
  actions: readonly OristudioCpActionDefinition[];
}

/** True for a tool that earns a place on the rail. */
export function isCpRailAction(action: OristudioCpActionDefinition): boolean {
  return action.placement === 'left-rail' || action.placement === 'left-rail-overflow';
}

/** Every rail group that has at least one tool, in catalogue order. */
export function cpRailGroups(): readonly CpRailGroup[] {
  return ORISTUDIO_CP_ACTION_GROUPS.map((group) => ({
    group,
    actions: cpActionsForGroup(group.id).filter(isCpRailAction),
  })).filter((entry) => entry.actions.length > 0);
}
