import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2, Plus, Printer } from "lucide-react";
import { Button } from "../ui/Button";
import { SplitButton } from "../ui/SplitButton";
import { DiagramHistoryButtons } from "./DiagramHistoryButtons";
import type { DiagramViewMode } from "../../store/workspaceStore/types";
import { DiagramViewSwitch } from "./DiagramViewSwitch";
import styles from "./DiagramHeader.module.css";

/**
 * The Diagram workspace's header: Steps | Pages at its left end, then the
 * verbs that act on the whole diagram at its right. The title is the Page
 * pane's (`DiagramTitleRow`; Zach, 2026-10-15). It wears the shared
 * `panel-toolbar` frame so it meets the side pane's tab bar at the same
 * height, and adds rules only for what is its own: on a screen too narrow for
 * both, the verbs wrap onto a row of their own under the tabs rather than off
 * the edge.
 */
export function DiagramHeader({
  stepCount,
  view,
  onViewChange,
  readOnly,
  onAddStep,
  onUpload,
  onImport,
  patternOpen,
  onLink,
  onFromReferences,
  onAddTurn,
  staleCount,
  poseAgainCount,
  refreshing,
  onRefreshAll,
  onStopRefreshing,
  onExport,
  onPrint,
  printing,
  drawerSlot,
}: {
  /** How many steps there are: with none, there is nothing to print or export. */
  stepCount: number;
  view: DiagramViewMode;
  onViewChange: (view: DiagramViewMode) => void;
  readOnly: boolean;
  onAddStep: () => void;
  /** Pick pictures, each a step. Called from the menu row itself. */
  onUpload: () => void;
  onImport: () => void;
  /** A crease pattern is open to link a step to. */
  patternOpen: boolean;
  /** Add a step and choose its pattern. */
  onLink: () => void;
  /** Open the References browser, adding after the selected step or at the end. */
  onFromReferences: () => void;
  /** Add a turn between steps (D22), after the selected step or at the end. */
  onAddTurn: (kind: "turn-over" | "rotate") => void;
  /** How many linked steps are out of date, and Refresh all would capture again. */
  staleCount: number;
  /** How many more are out of date but folded part way in the simulator: Pose captures those (D19). */
  poseAgainCount: number;
  /** Refresh all, while it runs: how far it has got. */
  refreshing: { total: number; done: number } | null;
  onRefreshAll: () => void;
  onStopRefreshing: () => void;
  /** Open the export dialog: a PDF of the pages, or a file for each step. */
  onExport: () => void;
  /** Print the pages, as the PDF prints them, through the print dialog. */
  onPrint: () => void;
  /** The pages are being made ready for the print dialog. */
  printing: boolean;
  /** Where the touch layer seats the Step pane's pill (`viewDrawerSlot`). */
  drawerSlot: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  return (
    <div className={`panel-toolbar ${styles.header}`}>
      <DiagramViewSwitch
        className={styles.views}
        view={view}
        onChange={onViewChange}
      />
      <div className={styles.verbs}>
        <div className={`panel-toolbar__group ${styles.actions}`}>
          <DiagramHistoryButtons />
          <SplitButton
            size="sm"
            variant="secondary"
            icon={<Plus size={14} aria-hidden="true" />}
            label={t("panels:diagram.header.addStep", "Add step")}
            disabled={readOnly}
            onClick={onAddStep}
            menuLabel={t(
              "panels:diagram.header.moreAdd",
              "More ways to add steps",
            )}
            actions={[
              { id: "import-steps", label: t("panels:diagram.import.menu", "Import steps…"), onSelect: onImport },
              {
                id: "upload-pictures",
                label: t(
                  "panels:diagram.header.uploadPictures",
                  "Upload pictures…",
                ),
                onSelect: onUpload,
              },
              {
                id: "link-pattern",
                label: t("panels:diagram.header.linkPattern", "Link pattern…"),
                disabled: !patternOpen,
                title: patternOpen
                  ? undefined
                  : t(
                      "panels:diagram.actions.noPatternHint",
                      "Open a crease pattern in Edit to link it",
                    ),
                onSelect: onLink,
              },
              {
                id: "from-references",
                label: t(
                  "panels:diagram.header.fromReferences",
                  "From References…",
                ),
                disabled: !patternOpen,
                title: patternOpen
                  ? undefined
                  : t(
                      "panels:diagram.actions.noPatternReferencesHint",
                      "Open a crease pattern in Edit to plan its folds",
                    ),
                opensDialog: true,
                onSelect: onFromReferences,
              },
              {
                id: "turn-over",
                label: t("panels:diagram.header.addTurnOver", "Turn Over"),
                title: t(
                  "panels:diagram.header.addTurnHint",
                  "Between steps, unnumbered: the model turned over or round",
                ),
                disabled: readOnly,
                onSelect: () => onAddTurn("turn-over"),
              },
              {
                id: "rotate",
                label: t("panels:diagram.header.addRotate", "Rotate"),
                title: t(
                  "panels:diagram.header.addTurnHint",
                  "Between steps, unnumbered: the model turned over or round",
                ),
                disabled: readOnly,
                onSelect: () => onAddTurn("rotate"),
              },
              refreshing
                ? {
                    id: "stop-refreshing",
                    label: t(
                      "panels:diagram.header.stopRefreshing",
                      "Stop refreshing ({{done}} of {{total}})",
                      {
                        done: refreshing.done,
                        total: refreshing.total,
                      },
                    ),
                    onSelect: onStopRefreshing,
                  }
                : {
                    id: "refresh-all",
                    label: t(
                      "panels:diagram.header.refreshAll",
                      "Refresh out-of-date steps",
                    ),
                    disabled: staleCount === 0,
                    title:
                      staleCount > 0
                        ? undefined
                        : poseAgainCount > 0
                          ? t("panels:diagram.header.onlyPoseAgain", {
                              count: poseAgainCount,
                              defaultValue_one:
                                "1 step folded part way in the simulator needs Pose Again.",
                              defaultValue_other:
                                "{{count}} steps folded part way in the simulator need Pose Again.",
                            })
                          : t(
                              "panels:diagram.header.nothingToRefresh",
                              "No linked step is out of date. Steps from References aren’t refreshed.",
                            ),
                    onSelect: onRefreshAll,
                  },
            ]}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={stepCount === 0 || printing}
            aria-busy={printing || undefined}
            title={
              stepCount === 0
                ? t(
                    "panels:diagram.header.nothingToPrint",
                    "Add a step to print the diagram",
                  )
                : undefined
            }
            onClick={onPrint}
          >
            {printing ? (
              <Loader2 size={14} className={styles.spinner} aria-hidden="true" />
            ) : (
              <Printer size={14} aria-hidden="true" />
            )}
            {printing
              ? t("panels:diagram.header.preparingPrint", "Preparing…")
              : t("panels:diagram.header.print", "Print…")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={stepCount === 0}
            title={
              stepCount === 0
                ? t(
                    "panels:diagram.header.nothingToExport",
                    "Add a step to export the diagram",
                  )
                : undefined
            }
            onClick={onExport}
          >
            <Download size={14} aria-hidden="true" />
            {t("panels:diagram.header.export", "Export…")}
          </Button>
          <div className="panel-toolbar__pills" ref={drawerSlot} />
        </div>
      </div>
    </div>
  );
}
