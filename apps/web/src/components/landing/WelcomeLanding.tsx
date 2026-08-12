import { Github, MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { track, type LandingCta, type LandingSectionId } from '../../analytics';
import { DISCORD_URL, REPOSITORY_URL } from '../../constants/release';
import { ButtonLink } from '../ui/Button';
import { LandingFigure } from './LandingFigure';
import { LandingSection } from './LandingSection';
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

  return (
    <div className="welcome-landing">
      <LandingSection
        id={FIRST_LANDING_SECTION_ID}
        eyebrow={t('landing:what.eyebrow', 'What it is')}
        title={t('landing:what.title', 'A free, open-source workspace for origami design')}
        lead={t(
          'landing:what.lead',
          'Ori Studio pulls the tools most of us already use into one place, and runs entirely in the browser — nothing to install, no account. The crease-pattern editor is a port of Oriedita, so if you have used that, this should feel familiar right away.'
        )}
      >
        <LandingFigure
          name="overview"
          alt={t(
            'landing:what.figureAlt',
            'The Ori Studio workspace: a crease pattern on the canvas with the tool rail and inspector panels around it.'
          )}
        />
        <p className="landing-beta">
          {t(
            'landing:what.beta',
            'Consider it a beta: stable enough for real work, but some features are still subject to change.'
          )}
        </p>
      </LandingSection>

      <LandingSection
        id="landing-edit"
        tone="raised"
        eyebrow={t('landing:edit.eyebrow', 'Crease patterns')}
        title={t('landing:edit.title', 'An editor you already know how to use')}
        lead={t(
          'landing:edit.lead',
          'The Edit workspace is a port of Oriedita — the same drawing operations, the same way selection and line types behave — wrapped in a modern, simplified interface.'
        )}
      >
        <LandingFigure
          name="edit"
          alt={t(
            'landing:edit.figureAlt',
            'The Edit workspace, showing crease-pattern drawing tools and a reference image beside the paper.'
          )}
        />
        <ul className="landing-features">
          <LandingFeature
            title={t('landing:edit.angles.title', 'Creases that are not 180°')}
            body={t(
              'landing:edit.angles.body',
              'Assign and solve real fold angles, not just mountain and valley, so models that do not fold flat are still first-class here.'
            )}
          />
          <LandingFeature
            title={t('landing:edit.media.title', 'Images and text, properly')}
            body={t(
              'landing:edit.media.body',
              'Put a reference photo of the subject next to the paper and annotate the canvas with rich text. Both are saved with the project and dropped cleanly when you export to a format that has no room for them.'
            )}
          />
          <LandingFeature
            title={t('landing:edit.diagnostics.title', 'Foldability you can check as you go')}
            body={t(
              'landing:edit.diagnostics.body',
              'Kawasaki and Maekawa checks, overlap and T-junction detection, and repairs for the ones worth fixing automatically.'
            )}
          />
          <LandingFeature
            title={t('landing:edit.share.title', 'Share a pattern with a link')}
            body={t(
              'landing:edit.share.body',
              'Send someone a crease pattern as a URL. They open it in their browser with nothing to install and nothing to sign up for.'
            )}
          />
        </ul>
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
        <LandingFigure
          name="design"
          alt={t(
            'landing:design.figureAlt',
            'The Design workspace with a tree structure beside its circle packing.'
          )}
        />
        <ul className="landing-features">
          <LandingFeature
            title={t('landing:design.treemaker.title', 'TreeMaker')}
            body={t(
              'landing:design.treemaker.body',
              'Sketch a tree, set edge lengths and strain, and let the optimizer pack circles and rivers into a base.'
            )}
          />
          <LandingFeature
            title={t('landing:design.bp.title', 'Box Pleating Studio')}
            body={t(
              'landing:design.bp.body',
              'Lay flaps out on a grid, with rivers, stretch devices and symmetry constraints, and read the crease pattern off the packing.'
            )}
          />
          <LandingFeature
            title={t('landing:design.explori.title', 'ExplOri')}
            body={t(
              'landing:design.explori.body',
              "Send your tree to Brandon Wong's searchable archive of 22.5° crease patterns and browse the closest matches it returns."
            )}
          />
        </ul>
      </LandingSection>

      <LandingSection
        id="landing-simulate"
        tone="raised"
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
        eyebrow={t('landing:compatibility.eyebrow', 'Compatibility')}
        title={t('landing:compatibility.title', 'Built on the tools you already use')}
        lead={t(
          'landing:compatibility.lead',
          'Much of Ori Studio is a careful port of work the origami community already built. Import and export interoperability with those tools is something this is committed to keeping — though it is worth saying plainly that interoperability is not the same as exact feature parity.'
        )}
      >
        <ul className="landing-ports">
          <LandingPort
            name="Oriedita"
            body={t(
              'landing:compatibility.oriedita',
              'The crease-pattern editor, and the bulk of what Ori Studio does.'
            )}
          />
          <LandingPort
            name="TreeMaker 5.0.1"
            body={t(
              'landing:compatibility.treemaker',
              "Robert J. Lang's solver for turning a tree structure into a crease pattern."
            )}
          />
          <LandingPort
            name="Box Pleating Studio"
            body={t(
              'landing:compatibility.bpStudio',
              'Box-pleated design, flap packing, and its stretch and river devices.'
            )}
          />
          <LandingPort
            name="Flat-Folder"
            body={t(
              'landing:compatibility.flatFolder',
              "Jason S. Ku's flat-foldability checking and layer ordering."
            )}
          />
        </ul>
        <p className="landing-formats">
          {t(
            'landing:compatibility.formats',
            'Imports and exports .ori, .cp, .fold, .bps, .tmd5 and .svg among others, so nothing you make here is trapped here.'
          )}
        </p>
        <p className="landing-formats">
          {t(
            'landing:compatibility.credit',
            'None of this would exist without the origami open-source community. The full list of acknowledgements is in the app, under Help › About.'
          )}
        </p>
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

/** Shared by the CTA links here and by the scroll affordance in the route. */
export function trackCta(cta: LandingCta): void {
  track('landing cta clicked', { cta });
}

interface LandingFeatureProps {
  title: string;
  body: string;
}

function LandingFeature({ title, body }: LandingFeatureProps): ReactNode {
  return (
    <li className="landing-feature">
      <h3 className="landing-feature__title">{title}</h3>
      <p className="landing-feature__body">{body}</p>
    </li>
  );
}

function LandingPort({ name, body }: { name: string; body: string }) {
  return (
    <li className="landing-port">
      {/* Upstream project names, never translated. */}
      <span className="landing-port__name">{name}</span>
      <span className="landing-port__body">{body}</span>
    </li>
  );
}
