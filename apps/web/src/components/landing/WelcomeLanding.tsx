import { Boxes, DraftingCompass, Github, PenTool } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RELEASES_URL, REPOSITORY_URL } from '../../constants/release';
import { ButtonLink } from '../ui/Button';
import { LandingSection } from './LandingSection';
import './WelcomeLanding.css';

/** The first section below the fold — where the scroll affordance jumps to. */
export const FIRST_LANDING_SECTION_ID = 'landing-what';

/**
 * The landing page below the fold on `/welcome`.
 *
 * Four sections, deliberately: what this is, the three workspaces, what it is
 * built on, and how to get it. The third is the one that matters most to the
 * people who would use this — they already own crease patterns, and the question
 * they are asking is whether their files still work.
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
        title={t('landing:what.title', 'One workspace, from tree to folded model')}
        lead={t(
          'landing:what.lead',
          'Ori Studio brings the tools origami designers already use into a single place. Sketch a tree structure and let it find a base, draw and edit the crease pattern by hand, then fold it in the simulator to see what you made — without exporting between four programs to do it.'
        )}
      />

      <LandingSection
        id="landing-workspaces"
        tone="raised"
        eyebrow={t('landing:workspaces.eyebrow', 'The workspaces')}
        title={t('landing:workspaces.title', 'Design, Edit, Simulate')}
      >
        <ul className="landing-cards">
          <LandingCard
            icon={<DraftingCompass size={18} />}
            title={t('landing:workspaces.design.title', 'Design')}
            body={t(
              'landing:workspaces.design.body',
              'Start from a tree structure and let the optimizer pack circles into a base, or lay flaps out on a box-pleating grid. Both hand you a crease pattern you can keep working on.'
            )}
          />
          <LandingCard
            icon={<PenTool size={18} />}
            title={t('landing:workspaces.edit.title', 'Edit')}
            body={t(
              'landing:workspaces.edit.body',
              'A full crease-pattern editor: draw, fold and unfold, check flat-foldability, and keep a reference photo of the subject beside the paper. It can also read a crease pattern straight out of an image.'
            )}
          />
          <LandingCard
            icon={<Boxes size={18} />}
            title={t('landing:workspaces.simulate.title', 'Simulate')}
            body={t(
              'landing:workspaces.simulate.body',
              'Fold the pattern and turn it over. The simulator runs on the crease pattern you are editing, so trying an idea never means leaving the document.'
            )}
          />
        </ul>
      </LandingSection>

      <LandingSection
        id="landing-compatibility"
        eyebrow={t('landing:compatibility.eyebrow', 'Compatibility')}
        title={t('landing:compatibility.title', 'Built on the tools you already use')}
        lead={t(
          'landing:compatibility.lead',
          'Much of Ori Studio is a careful port of work the origami community already built, and staying compatible with it is a priority rather than an afterthought.'
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
            'Opens and exports .cp, .fold, .ori, .orh, .tmd5 and .bps, so nothing you make here is trapped here.'
          )}
        </p>
      </LandingSection>

      <LandingSection
        id="landing-get"
        tone="raised"
        eyebrow={t('landing:get.eyebrow', 'Get it')}
        title={t('landing:get.title', 'Run it in the browser, or install it')}
        lead={t(
          'landing:get.lead',
          'The web app is the whole thing — no account, and your files stay on your machine unless you choose to share one. The desktop build adds native menus, file dialogs, and opening files from Finder.'
        )}
      >
        <div className="landing-actions">
          <ButtonLink variant="primary" size="lg" href={RELEASES_URL} rel="noreferrer">
            {t('landing:get.download', 'Download for macOS')}
          </ButtonLink>
          <ButtonLink variant="secondary" size="lg" href={REPOSITORY_URL} rel="noreferrer">
            <Github size={15} aria-hidden="true" />
            {t('landing:get.github', 'View the source')}
          </ButtonLink>
        </div>
        <p className="landing-actions__note">
          {t(
            'landing:get.note',
            'Signed Apple Silicon builds today; other platforms are coming, and help with them is welcome.'
          )}
        </p>
      </LandingSection>
    </div>
  );
}

interface LandingCardProps {
  icon: ReactNode;
  title: string;
  body: string;
}

function LandingCard({ icon, title, body }: LandingCardProps) {
  return (
    <li className="landing-card">
      <span className="landing-card__icon">{icon}</span>
      <h3 className="landing-card__title">{title}</h3>
      <p className="landing-card__body">{body}</p>
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
