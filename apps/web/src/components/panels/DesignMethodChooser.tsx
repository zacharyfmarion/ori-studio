import { useState, type ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { designKind, designKindsForChooser } from '../../designKinds';
import type { DesignKindDescriptor, DesignKindId } from '../../designKinds';
import { resetEngine } from '../../engines/engineHost';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Button } from '../ui/Button';

/**
 * Design workspace NUX. When no design method has been chosen yet, the Design
 * pane presents the registered authoring methods side by side.
 *
 * The cards are built from the design-kind registry rather than hardcoded, so a
 * new kind appears here by registering a descriptor. Each kind supplies its own
 * copy, icon, ordering, and availability rule — see `designKinds/types.ts`.
 */
export function DesignMethodChooser() {
  const { t } = useTranslation();
  const engineReady = useWorkspaceStore((state) => state.engineReady);
  const status = useWorkspaceStore((state) => state.status);
  const chooseDesignMethod = useWorkspaceStore((state) => state.chooseDesignMethod);
  /**
   * The method being created, while the engine builds it.
   *
   * Creating a design is a cold start of a wasm worker — seconds on a first
   * visit. Without this the chooser sat there looking untouched, and a second
   * click started a second creation.
   */
  const [pending, setPending] = useState<DesignKindId | null>(null);
  /** The kind whose last attempt failed, so the chooser can explain and retry. */
  const [failed, setFailed] = useState<DesignKindId | null>(null);

  // No navigation: picking a method changes what *this tab* is authoring, and the
  // Design workspace has one route. It used to send the app to `/design/bp` or
  // `/design/treemaker`, which is exactly the assumption tabs remove — with two
  // designs open there is no single method for a URL to name.
  const chooseMethod = async (target: DesignKindId) => {
    if (pending) return;
    setPending(target);
    setFailed(null);
    // The *result*, and not only a `.catch()`. Every creator catches its own
    // error and reports it as `false`, so the rejection this used to wait for
    // never came and the spinner ran forever — the offline box-pleat hang. The
    // catch stays as well, for a creator that breaks that contract: either way
    // the answer is "not created", and neither may leave the chooser dead.
    //
    // On success this component unmounts (the tab now has a kind), so the state
    // written below is for the failure path only.
    const created = await chooseDesignMethod(target).catch(() => false);
    if (created) return;
    setPending(null);
    setFailed(target);
  };

  /**
   * Try again, from a state that can succeed.
   *
   * The engine reset is the load-bearing half. A wasm bridge memoizes its own
   * `init()` — `ready ??= init()` — so a rejected one is cached for the worker's
   * whole life, and a plain retry re-reads that same rejection however long the
   * network has been back. Replacing the worker is what clears it, and
   * `resetEngine` is already the app's word for that (a crash takes the same
   * path). A kind with no engine has nothing to reset and nothing memoized.
   */
  const retry = (target: DesignKindId) => {
    const engine = designKind(target)?.engine;
    if (engine) resetEngine(engine);
    void chooseMethod(target);
  };

  return (
    <section className="panel-shell design-panel design-method-chooser">
      <div className="design-method-chooser__body">
        <div className="design-method-chooser__intro">
          <h2 className="design-method-chooser__title">
            {t('panels:design.methodChooser.title', 'Start a new design')}
          </h2>
          <p className="design-method-chooser__subtitle">
            {t('panels:design.methodChooser.subtitle', 'Choose how you want to author this model.')}
          </p>
        </div>
        {failed && <ChooserFailure kind={failed} onRetry={() => retry(failed)} />}
        <div
          className="design-method-chooser__options"
          role="group"
          aria-label={t('panels:design.methodChooser.groupLabel', 'Design method')}
        >
          {designKindsForChooser().map((kind) => (
            <MethodCard
              key={kind.id}
              kind={kind}
              disabled={pending !== null || !kind.chooser.isAvailable({ engineReady, status })}
              pending={pending === kind.id}
              onSelect={() => void chooseMethod(kind.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Why a design could not be created, and a way to try again.
 *
 * The offline branch is not decoration. The service worker caches what a
 * session actually fetched (see the invariants in `pwa/sw.ts`), and a kind's
 * wasm kernel is fetched the first time one of its designs is created — so an
 * installed app whose only online session opened the Edit canvas has the CP and
 * TreeMaker kernels cached and not the box-pleat one. "Preparing the editor
 * failed" is true there and useless; "this needs the network once" is what the
 * user can act on.
 *
 * `navigator.onLine` is a weak signal in general — true means "there is an
 * interface", not "the internet works" — but it is used here only to choose
 * wording after a failure that already happened, which is the one job it is
 * reliable for: `false` really does mean no request could have succeeded.
 */
function ChooserFailure({ kind, onRetry }: { kind: DesignKindId; onRetry: () => void }) {
  const { t } = useTranslation();
  const engineError = useWorkspaceStore((state) => state.error?.message ?? null);
  const boxPleatError = useWorkspaceStore((state) => state.oristudioBpError);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const title = designKind(kind)?.chooser.copy(t).title ?? kind;

  return (
    <div className="design-method-chooser__failure" role="alert">
      <AlertTriangle size={16} aria-hidden="true" />
      <div className="design-method-chooser__failure-copy">
        <strong>
          {t('panels:design.methodChooser.failedTitle', 'Could not start a {{method}} design', {
            method: title,
          })}
        </strong>
        <span>{failureDetail(t, offline, engineError ?? boxPleatError)}</span>
      </div>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        {t('panels:design.methodChooser.retry', 'Try again')}
      </Button>
    </div>
  );
}

/** Literal `t()` calls, so the extractor sees every key. */
function failureDetail(t: TFunction, offline: boolean, reason: string | null): string {
  if (offline) {
    return t(
      'panels:design.methodChooser.failedOffline',
      'This design type has not been downloaded yet, and you are offline. Connect once and it will work offline from then on.'
    );
  }
  return (
    reason ??
    t('panels:design.methodChooser.failedUnknown', 'The editor for this design type did not load.')
  );
}

interface MethodCardProps {
  kind: DesignKindDescriptor;
  disabled: boolean;
  /** This is the card that was clicked, and its design is being built. */
  pending: boolean;
  onSelect: () => void;
}

function MethodCard({ kind, disabled, pending, onSelect }: MethodCardProps) {
  const { t } = useTranslation();
  const { title, description } = kind.chooser.copy(t);
  const icon: ReactNode = pending ? <Loader2 size={22} className="design-method-card__spinner" /> : <kind.chooser.Icon size={22} />;
  return (
    <button
      type="button"
      className="design-method-card"
      data-method={kind.id}
      data-pending={pending || undefined}
      disabled={disabled}
      aria-busy={pending}
      onClick={onSelect}
    >
      <span className="design-method-card__icon">{icon}</span>
      <span className="design-method-card__title">{title}</span>
      <span className="design-method-card__description">
        {pending
          ? t('panels:design.methodChooser.creating', 'Preparing the editor…')
          : description}
      </span>
    </button>
  );
}
