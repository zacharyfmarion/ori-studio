import { Github, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { track, type LandingCta, type LandingSectionId } from '../../analytics';
import { DISCORD_URL, REPOSITORY_URL } from '../../constants/release';
import { ButtonLink } from '../ui/Button';
import { LandingFeatureList } from './LandingFeatureList';
import { LandingSwipeCarousel, type LandingSwipeItem } from './LandingSwipeCarousel';
import { LandingFigure } from './LandingFigure';
import { LandingFormatRing } from './LandingFormatRing';
import { LandingSection } from './LandingSection';
import { useIsPhoneSurface } from '../../platform/mobileSurface';
import './WelcomeLanding.css';

/** The first section below the fold — where the scroll affordance jumps to. */
export const FIRST_LANDING_SECTION_ID = 'landing-what';

/**
 * The sections, paired with the enum each reports as. Exported so the route can
 * hand it to the scroll observer without re-deriving the page's own structure.
 */
export const LANDING_SECTIONS = [
  { id: FIRST_LANDING_SECTION_ID, section: 'what' },
  { id: 'landing-edit', section: 'edit' },
  { id: 'landing-design', section: 'design' },
  { id: 'landing-simulate', section: 'simulate' },
  { id: 'landing-compatibility', section: 'compatibility' },
  { id: 'landing-get', section: 'get' },
] as const satisfies ReadonlyArray<{ id: string; section: LandingSectionId }>;

/**
 * The landing page below the fold on `/welcome`.
 *
 * The pitch, in the order it lands: what this is, then the crease-pattern editor
 * (the bulk of the app, and the thing that decides whether someone stays), then
 * the design workspace and the simulator, then compatibility, then how to get in.
 *
 * Two claims it deliberately does **not** make, because neither has shipped: a
 * desktop download, and reading a crease pattern out of an image. The detector is
 * behind `import.meta.env.DEV` and the desktop build is not released.
 *
 * The same content serves the desktop page and the phone one; only what sits
 * above it differs (the start screen, or the desktop-only notice).
 */
export function WelcomeLanding() {
  const { t } = useTranslation();
  const phone = useIsPhoneSurface();

  return (
    <div className="welcome-landing">
      <LandingSection
        id={FIRST_LANDING_SECTION_ID}
        layout="split"
        eyebrow={t('landing:what.eyebrow', 'What it is')}
        title={t('landing:what.title', 'A free, open-source workspace for origami design')}
        lead={t(
          'landing:what.lead',
          'Sketch a base, draw the crease pattern, and fold it to see whether it works — in one place, in the browser, with nothing to install and no account.'
        )}
      >
        <LandingFigure
          name="overview"
          alt={t(
            'landing:what.figureAlt',
            'The Ori Studio workspace: a crease pattern on the canvas with the tool rail and inspector panels around it.'
          )}
        />
      </LandingSection>

      <LandingSection
        id="landing-edit"
        tone="raised"
        eyebrow={t('landing:edit.eyebrow', 'Crease patterns')}
        title={t('landing:edit.title', 'A crease-pattern editor that keeps up')}
        lead={t(
          'landing:edit.lead',
          'Draw with a full set of construction and transform tools, snapped to the grid and to angles, and see foldability problems the moment you make them. Reference photos, notes and a folded preview all live on the same canvas.'
        )}
      >
        <EditFeatures
          label={t('landing:edit.carouselLabel', 'Crease-pattern features')}
          items={[
            {
              id: 'edit-angles',
              figure: 'edit-angles',
              title: t('landing:edit.angles.title', 'Support for non-flat creases'),
              body: t(
                'landing:edit.angles.body',
                'Assign and solve real fold angles, not just mountain and valley, so models that do not fold flat are still first-class here.'
              ),
              figureAlt: t(
                'landing:edit.angles.figureAlt',
                'A crease pattern with fold-angle labels on its creases.'
              ),
            },
            {
              id: 'edit-media',
              figure: 'edit-media',
              title: t('landing:edit.media.title', 'Rich Images and Text'),
              body: t(
                'landing:edit.media.body',
                'Put a reference photo of the subject next to the paper and annotate the canvas with rich text. Both are saved with the project and dropped cleanly when you export to a format that has no room for them.'
              ),
              figureAlt: t(
                'landing:edit.media.figureAlt',
                'A reference photo and a text annotation placed beside a crease pattern.'
              ),
            },
            {
              id: 'edit-foldability',
              figure: 'edit-foldability',
              title: t('landing:edit.diagnostics.title', 'Foldability you can check as you go'),
              body: t(
                'landing:edit.diagnostics.body',
                'Kawasaki and Maekawa where the paper folds flat, plus overlap and T-junction detection. Where it does not fold flat, each vertex is checked in three dimensions instead — walking the creases around it to see whether the folds close back up, and telling you how many degrees off they are when they do not.'
              ),
              figureAlt: t(
                'landing:edit.diagnostics.figureAlt',
                'Foldability diagnostics marking problem vertices on a crease pattern.'
              ),
            },
            {
              id: 'edit-share',
              figure: 'edit-share',
              title: t('landing:edit.share.title', 'Share a pattern with a link'),
              body: t(
                'landing:edit.share.body',
                'Send someone a crease pattern as a URL. They open it in their browser with nothing to install and nothing to sign up for.'
              ),
              figureAlt: t('landing:edit.share.figureAlt', 'The share-link dialog with a copyable URL.'),
            },
          ]}
        />
      </LandingSection>

      <LandingSection
        id="landing-design"
        eyebrow={t('landing:design.eyebrow', 'Design')}
        title={t('landing:design.title', 'A tabbed design workspace')}
        lead={t(
          'landing:design.lead',
          'Pack your model with whichever method suits it, with several designs open side by side in tabs. Each one builds a crease pattern you can send straight to the editor.'
        )}
      >
        <LandingSwipeCarousel
          showTabs={!phone}
          label={t('landing:design.carouselLabel', 'Design methods')}
          items={[
            // Ordered and titled by the *method*, not by the tool it came from:
            // someone choosing how to pack a model is picking box pleating or
            // circle packing, and only then cares which port implements it. The
            // ids and figure names still say `design-bp` / `design-treemaker`,
            // because those are what analytics reports and what the screenshots
            // on disk are called.
            {
              id: 'design-bp',
              figure: 'design-bp',
              title: t('landing:design.bp.title', 'Box Pleating'),
              body: t(
                'landing:design.bp.body',
                'Lay flaps out on a grid, with rivers, stretch devices and symmetry constraints, and read the crease pattern off the packing.'
              ),
              figureAlt: t(
                'landing:design.bp.figureAlt',
                'Flaps packed onto a box-pleating grid with its crease pattern alongside.'
              ),
            },
            {
              id: 'design-treemaker',
              figure: 'design-treemaker',
              title: t('landing:design.treemaker.title', 'Circle Packing'),
              body: t(
                'landing:design.treemaker.body',
                'Sketch a tree, set edge lengths and strain, and let the optimizer pack circles and rivers into a base.'
              ),
              figureAlt: t(
                'landing:design.treemaker.figureAlt',
                'A tree structure beside the circle packing the optimizer found for it.'
              ),
            },
            {
              id: 'design-explori',
              figure: 'design-explori',
              title: t('landing:design.explori.title', 'ExplOri'),
              body: t(
                'landing:design.explori.body',
                "Send your tree to Brandon Wong's searchable archive of 22.5° crease patterns and browse the closest matches it returns."
              ),
              figureAlt: t(
                'landing:design.explori.figureAlt',
                'A grid of 22.5° crease patterns returned from an ExplOri search.'
              ),
            },
          ]}
        />
      </LandingSection>

      <LandingSection
        id="landing-simulate"
        tone="raised"
        layout="split-reverse"
        eyebrow={t('landing:simulate.eyebrow', 'Simulate')}
        title={t('landing:simulate.title', 'Fold it without leaving the pattern')}
        lead={t(
          'landing:simulate.lead',
          'Open a simulation in a window right next to the crease pattern you are drawing, so checking an idea costs a glance instead of a round trip through another program. A full Simulate workspace is there when you want the model on its own.'
        )}
      >
        <LandingFigure
          name="simulate"
          alt={t(
            'landing:simulate.figureAlt',
            'A folded 3D model simulating inline beside its crease pattern.'
          )}
        />
      </LandingSection>

      <LandingSection
        id="landing-compatibility"
        layout="split"
        eyebrow={t('landing:compatibility.eyebrow', 'Compatibility')}
        title={t('landing:compatibility.title', 'Built on the tools you already use')}
        lead={t(
          'landing:compatibility.lead',
          'Much of Ori Studio is a careful port of work the community already built — Oriedita, TreeMaker and Box Pleating Studio — and keeping import and export interoperability with those tools is a commitment, though it is not the same as exact feature parity.'
        )}
      >
        <LandingFormatRing />
      </LandingSection>

      <LandingSection
        id="landing-get"
        tone="raised"
        eyebrow={t('landing:get.eyebrow', 'Get started')}
        title={t('landing:get.title', 'It runs in the browser. Nothing to install.')}
        lead={t(
          'landing:get.lead',
          'Scroll back up and start a crease pattern — that is the whole setup. If you hit a bug or have an idea, the Discord is the best place to reach me, and it is where I post what I am working on next.'
        )}
      >
        <div className="landing-actions">
          <ButtonLink
            variant="primary"
            size="lg"
            href={DISCORD_URL}
            rel="noreferrer"
            onClick={() => trackCta('discord')}
          >
            <MessageCircle size={15} aria-hidden="true" />
            {t('landing:get.discord', 'Join the Discord')}
          </ButtonLink>
          <ButtonLink
            variant="secondary"
            size="lg"
            href={REPOSITORY_URL}
            rel="noreferrer"
            onClick={() => trackCta('github')}
          >
            <Github size={15} aria-hidden="true" />
            {t('landing:get.github', 'Source and issues')}
          </ButtonLink>
        </div>
      </LandingSection>
    </div>
  );
}

/**
 * The Edit section's four features: a vertical list beside a panel where there
 * is room for one, a swipe carousel on a phone where there is not.
 *
 * Two components rather than one that does both, because they are different
 * controls — a list you scan against a track you swipe — and the seam between
 * them belongs here, at the one call site that has to choose.
 */
function EditFeatures({ label, items }: { label: string; items: readonly LandingSwipeItem[] }) {
  const phone = useIsPhoneSurface();
  if (phone) return <LandingSwipeCarousel showTabs={false} label={label} items={items} />;
  return <LandingFeatureList label={label} items={items} />;
}

/** Shared by the CTA links here and by the scroll affordance in the route. */
export function trackCta(cta: LandingCta): void {
  track('landing cta clicked', { cta });
}

