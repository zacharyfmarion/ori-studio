/**
 * The reference image a suppression region owns, controlled from the region's
 * own bar.
 *
 * # Why the chip owns it at all
 *
 * A detection drops its rectified source frame behind the candidate creases, and
 * that image has to be **inert**: the whole point of the repair flow is drawing
 * and deleting creases on top of it, and an image that took pointer events would
 * swallow every one of those clicks. So it is `locked`, and locked is absolute —
 * `CanvasObjectOverlay` gives it no body, no handles, no context menu, and
 * `annotationAtModelPoint` skips it. There is no lock toggle anywhere in the
 * product and no layers panel, so the image was, in the shipped build, an
 * unreachable 50%-opacity underlay: the user could neither hide it, fade it,
 * nor delete it, and accepting the solve orphaned it into the document forever.
 *
 * This menu is the way back in. It is deliberately *not* a general layer
 * inspector — that is the "future general layer model" `CpImageInspector` defers
 * to — it is the three things a repair actually needs: is it showing, how
 * strongly, and is it gone.
 *
 * # Why these three and not the shared set
 *
 * `AnnotationActions` also offers bring-to-front and send-to-back, and neither
 * means anything here. The renderer's z-slot order is fixed — grid, then
 * regions, then images, then creases — so a reference image is already exactly
 * where the user asked for it, under the creases and over the region's wash, and
 * `z` only ever sorts *within* the image layer. A control that reordered it
 * against the creases would be a control that does nothing.
 *
 * # Why a dropdown rather than three buttons on the bar
 *
 * The bar is as wide as its region and it already carries Solve, the checks menu
 * and delete. Three more would be the crowding that took the prose off it in the
 * first place. Modelled on `CheckClassMenu` in `SuppressionRegionChip` — same
 * `MenuIconButton` trigger, same portalled `context-menu` content — because a
 * second dropdown on the same bar looking like a different kind of thing would
 * be worse than either.
 */
import { useTranslation } from 'react-i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  MenuCheckboxItem,
  MenuContent,
  MenuControlRow,
  MenuItem,
  MenuItemIcon,
  MenuItemLabel,
  MenuSeparator,
} from '../../components/ui/Menu';
import { Check, Image as ImageIcon, Trash2 } from 'lucide-react';
import { MenuIconButton } from '../../components/ui/MenuIconButton';
import { GestureSlider } from '../../components/ui/GestureSlider';
import type { CpImage } from '../images/cpImage';

/** The verbs a region's owned image offers, all bracketed as one undo entry. */
export interface CpRegionImageActions {
  onToggleImageHidden: () => void;
  onImageOpacity: (opacity: number) => void;
  onDeleteImage: () => void;
  onGestureStart: () => void;
  onGestureCommit: (label: string) => void;
}

export interface RegionImageMenuProps extends CpRegionImageActions {
  image: CpImage;
}

export function RegionImageMenu({
  image,
  onToggleImageHidden,
  onImageOpacity,
  onDeleteImage,
  onGestureStart,
  onGestureCommit,
}: RegionImageMenuProps) {
  const { t } = useTranslation();
  const shown = !image.hidden;
  return (
    <DropdownMenu.Root>
      <MenuIconButton
        label={t('panels:cpRegion.imageMenu', 'Reference image')}
        icon={<ImageIcon size={14} />}
        isActive={shown}
      />
      <MenuContent
        side="bottom"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        loop
      >
        <MenuCheckboxItem
          checked={shown}
          onSelect={(event) => {
            // Kept open across the toggle, as the checks menu is: showing and
            // fading are usually adjusted together, and the slider below is in
            // this same menu.
            event.preventDefault();
            onToggleImageHidden();
          }}
        >
          <MenuItemIcon>{shown && <Check size={12} />}</MenuItemIcon>
          <MenuItemLabel>{t('panels:cpRegion.imageShow', 'Show reference image')}</MenuItemLabel>
        </MenuCheckboxItem>
        {/*
          A label rather than a menu item: a `DropdownMenu.Item` owns arrow keys
          and Enter, which are exactly the keys a range input needs, so wrapping
          the slider in one would make it unusable from the keyboard.
          `onKeyDown` stops Radix's typeahead and roving focus seeing the keys
          at all, which is what leaves the native slider behaviour intact.
        */}
        <MenuControlRow onKeyDown={(event) => event.stopPropagation()}>
          <MenuItemIcon aria-hidden="true" />
          <MenuItemLabel>{t('panels:cpRegion.imageOpacity', 'Opacity')}</MenuItemLabel>
          <GestureSlider
            min={0}
            max={100}
            value={Math.round(image.opacity * 100)}
            onChange={(percent) => onImageOpacity(percent / 100)}
            onGestureStart={onGestureStart}
            onGestureCommit={onGestureCommit}
            commitLabel={t('panels:cpRegion.imageAdjustOpacity', 'Adjust reference image')}
            aria-label={t('panels:cpRegion.imageOpacity', 'Opacity')}
          />
        </MenuControlRow>
        <MenuSeparator />
        <MenuItem onSelect={onDeleteImage}>
          <MenuItemIcon>
            <Trash2 size={12} />
          </MenuItemIcon>
          <MenuItemLabel>
            {t('panels:cpRegion.imageDelete', 'Remove reference image')}
          </MenuItemLabel>
        </MenuItem>
      </MenuContent>
    </DropdownMenu.Root>
  );
}
