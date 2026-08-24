import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { handleMenuAction } from '../commands/menuActions';
import { getMenuBarDef, type MenuDef, type MenuItemDef } from '../menus/menuDefinition';
import { isMenuItemVisible, menuHasVisibleItems, pruneMenuItems } from '../menus/menuVisibility';
import { useIsPhoneLayout } from '../platform/phoneLayout';
import { useShortcutStore } from '../store/shortcutStore';
import { useWorkspaceCapabilities } from '../store/workspaceStore/useWorkspaceCapabilities';
import type { WorkspaceCapabilities, WorkspaceCapabilityId } from '../lib/workspaceCapabilities';
import './MenuBar.css';

/**
 * Where an open phone dropdown has to stop.
 *
 * The tab bar's top edge, not the screen's bottom. The dropdown sits at
 * `z-index: 9999` in the root stacking context — every positioned ancestor up to
 * `.app-layout` is `z-index: auto` — so a menu tall enough to reach the tabs
 * takes their taps rather than sitting behind them. Hit-testing a deliberately
 * over-tall dropdown in the tab lane returned the menu, and the rows down there
 * are Delete Selected and Delete Selected CP Lines: aiming at Simulate and
 * deleting a selection is the worst failure available here.
 *
 * With no tab bar the floor is the shell's *content* box. `.app-layout` pads by
 * `--safe-bottom`, and the home-indicator strip below that is not somewhere a
 * tappable row should end up.
 */
function phoneMenuFloor(layout: Element | null, rail: Element | null): number | null {
  if (rail) return rail.getBoundingClientRect().top;
  if (!(layout instanceof HTMLElement)) return null;
  const rect = layout.getBoundingClientRect();
  return rect.bottom - (parseFloat(getComputedStyle(layout).paddingBottom) || 0);
}

/**
 * Publish that floor to the stylesheet as `--menu-dropdown-max-height`, on the
 * open root dropdown.
 *
 * Measured rather than restated: the toolbar is 55px in portrait and 45 in
 * landscape, and the tab bar's height follows its captions, so a locale whose
 * caption wraps moves the floor. `useCpDiagnosticHudLane` measures the boxes it
 * places against for the same reason, and scopes its cross-component lookup with
 * the same `closest`.
 *
 * Writing `max-height` cannot move what was measured: the box is absolutely
 * positioned at `top: calc(100% + 2px)` off a wrapper this never touches.
 */
function usePhoneMenuMaxHeight(enabled: boolean): (node: HTMLDivElement | null) => void {
  const [menu, setMenu] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!enabled || !menu) return undefined;

    const layout = menu.closest('.app-layout');
    const rail = layout?.querySelector('.workspace-rail') ?? null;

    const measure = () => {
      const floor = phoneMenuFloor(layout, rail);
      if (floor === null) {
        menu.style.removeProperty('--menu-dropdown-max-height');
        return;
      }
      const top = menu.getBoundingClientRect().top;
      menu.style.setProperty(
        '--menu-dropdown-max-height',
        `calc(${Math.max(0, floor - top)}px - var(--space-1))`
      );
    };

    measure();

    // A rotation is the only thing that can move either box while a menu is
    // open, and it resizes the viewport — so one listener covers it.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [enabled, menu]);

  return setMenu;
}

/**
 * A phone renders a submenu as an indented group inside the dropdown, so the
 * classes that make one a sideways fly-out are never emitted there at all —
 * `.menu-dropdown--submenu` and the `:hover` / `:focus-within` rules that reveal
 * it simply cannot match. That is what lets the root scroll: an overflow of any
 * kind would clip a box that opens *out of* its parent, and the box in question
 * is Export.
 */
function dropdownClassName(nested: boolean, phone: boolean): string {
  if (nested) return phone ? 'menu-dropdown__group' : 'menu-dropdown menu-dropdown--submenu';
  return phone ? 'menu-dropdown menu-dropdown--phone' : 'menu-dropdown';
}

function MenuDropdown({
  items,
  onAction,
  onClose,
  capabilities,
  phone,
  nested = false,
}: {
  items: MenuItemDef[];
  onAction: (id: string) => void;
  onClose: () => void;
  capabilities: WorkspaceCapabilities;
  phone: boolean;
  nested?: boolean;
}) {
  const visibleItems = pruneMenuItems(items, capabilities);
  // Keyed by label, not by index: `pruneMenuItems` re-runs every render, so a
  // capability flipping while the menu is open would shift the indices under a
  // stored number and expand a different group. The label is already the key.
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null);
  const setMenuNode = usePhoneMenuMaxHeight(phone && !nested);

  return (
    <div className={dropdownClassName(nested, phone)} role="menu" ref={setMenuNode}>
      {visibleItems.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={`separator-${index}`} className="menu-dropdown__separator" />;
        }

        if (item.type === 'command') {
          return (
            <button
              key={`command-${index}-${item.actionId}`}
              type="button"
              className="menu-dropdown__item"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                onAction(item.actionId);
                onClose();
              }}
            >
              <span className="menu-dropdown__item-label">{item.label}</span>
            </button>
          );
        }

        if (item.type === 'submenu') {
          if (!isMenuItemVisible(item, capabilities)) return null;

          const expanded = phone && expandedLabel === item.label;

          return (
            <div key={item.label} className="menu-dropdown__submenu" role="none">
              <button
                type="button"
                className={`menu-dropdown__item menu-dropdown__item--submenu ${
                  expanded ? 'menu-dropdown__item--expanded' : ''
                }`.trim()}
                role="menuitem"
                aria-haspopup="menu"
                // Stated only where React knows it. On a mouse the open state
                // lives entirely in `:hover` / `:focus-within`, so any value
                // here would be a guess; inline expansion is what finally makes
                // it a fact. The tree is otherwise unchanged — ARIA has no
                // notion of "flies out sideways", and a menuitem owning a menu
                // is the same relation either way.
                aria-expanded={phone ? expanded : undefined}
                // Click, and never focus. `focus` fires on pointerdown, so
                // expanding there would reflow the list under the finger
                // between pointerdown and click — the way the BP packing pane
                // used to drop taps. Enter and Space on a button raise `click`
                // anyway, which is the chord the ARIA menu pattern asks for.
                onClick={
                  phone
                    ? () => setExpandedLabel(expanded ? null : item.label)
                    : (event) => event.preventDefault()
                }
              >
                <span className="menu-dropdown__item-label">{item.label}</span>
                <span className="menu-dropdown__submenu-arrow" aria-hidden="true">
                  <ChevronRight size={13} />
                </span>
              </button>
              {/* A collapsed group must leave the accessibility tree, not just
                  the picture — on a mouse `display: none` does that, and here
                  nothing is mounted in the first place. */}
              {(!phone || expanded) && (
                <MenuDropdown
                  items={item.items}
                  onAction={onAction}
                  onClose={onClose}
                  capabilities={capabilities}
                  phone={phone}
                  nested
                />
              )}
            </div>
          );
        }

        const capability = capabilities[item.id as WorkspaceCapabilityId];
        if (capability && !capability.visible) return null;

        return (
          <button
            key={item.id}
            type="button"
            className="menu-dropdown__item"
            role="menuitem"
            disabled={capability ? !capability.enabled : false}
            title={capability?.reason}
            onClick={() => {
              if (capability && !capability.enabled) return;
              onAction(item.id);
              onClose();
            }}
          >
            <span className="menu-dropdown__item-label">{capability?.label ?? item.label}</span>
            {item.shortcut && (
              <span className="menu-dropdown__item-shortcut">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const shortcutOverrides = useShortcutStore((state) => state.overrides);
  // Accelerators shown in the menus resolve against the active layout, the same
  // as the canvas and the native bar. Missing it here showed Oriedita users the
  // chords they had just switched away from.
  const shortcutDefaultsSource = useShortcutStore((state) => state.defaultsSource);
  const { t } = useTranslation();
  const menuDef = useMemo(
    () =>
      getMenuBarDef(
        { overrides: shortcutOverrides, defaultsSource: shortcutDefaultsSource },
        (key, defaultValue) => t(key, defaultValue)
      ),
    [shortcutOverrides, shortcutDefaultsSource, t]
  );
  const capabilities = useWorkspaceCapabilities();
  // Hiding New/Open/Save from the toolbar (App.css, the phone block) made this
  // bar the only way to reach them, which made its 28px rows the smallest
  // targets on the surface built for fingertips.
  const phone = useIsPhoneLayout();
  const visibleMenus = useMemo<MenuDef[]>(
    () => menuDef.filter((menu) => menuHasVisibleItems(menu, capabilities)),
    [menuDef, capabilities]
  );

  const closeMenu = useCallback(() => {
    setOpenMenu(null);
  }, []);

  const runAction = useCallback((id: string) => {
    void handleMenuAction(id);
  }, []);

  useEffect(() => {
    if (openMenu === null) return undefined;

    const onClickOutside = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };

    document.addEventListener('mousedown', onClickOutside);
    // `mousedown` alone cannot dismiss a phone menu over the canvas. On touch it
    // is a *compatibility* event, synthesised after `touchend` and suppressed
    // outright when the page handles the touch itself — and the crease-pattern
    // canvas does, on every contact. Measured in Mobile Safari: with File open,
    // one tap on the canvas selected a crease and left the menu standing, so the
    // largest region of the phone was not a way out of the menu.
    //
    // `pointerdown` is a real event rather than a synthesised one, and a capture
    // listener here runs before the canvas' own handler can claim the contact,
    // so it fires whatever the target does. Phone-only: a mouse already closes
    // on `mousedown`, and this must not change what a fine pointer does.
    if (phone) document.addEventListener('pointerdown', onClickOutside, true);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('pointerdown', onClickOutside, true);
      document.removeEventListener('keydown', onEscape);
    };
  }, [openMenu, phone]);

  return (
    <div className="menubar" ref={menuRef}>
      <div className="menubar__menus">
        {visibleMenus.map((menu, index) => (
          <div key={menu.label} className="menubar__menu-wrapper">
            <button
              type="button"
              className={`menubar__trigger ${
                openMenu === index ? 'menubar__trigger--active' : ''
              }`}
              aria-haspopup="menu"
              aria-expanded={openMenu === index}
              onClick={() => setOpenMenu(openMenu === index ? null : index)}
              onMouseEnter={() => {
                if (openMenu !== null) setOpenMenu(index);
              }}
            >
              {menu.label}
            </button>
            {openMenu === index && (
              <MenuDropdown
                items={menu.items}
                onAction={runAction}
                onClose={closeMenu}
                capabilities={capabilities}
                phone={phone}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
