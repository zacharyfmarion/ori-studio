import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { Download, Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { SplitButton } from "../ui/SplitButton";
import { DiagramHistoryButtons } from "./DiagramHistoryButtons";
import type { DiagramViewMode } from "../../store/workspaceStore/types";
import { DiagramTitleField } from "./DiagramTitleField";
import { DiagramViewSwitch } from "./DiagramViewSwitch";
import styles from "./DiagramHeader.module.css";

/**
 * The Diagram workspace's header: the title and how many steps, then the verbs
 * that act on the whole diagram. It wears the shared `panel-toolbar` frame so
 * it meets the side pane's tab bar at the same height, and adds rules only for
 * what is its own: on a screen too narrow for both, the verbs wrap onto a row
 * of their own under the title rather than off the edge.
 */
export function DiagramHeader({
  title,
  stepCount,
  pageCount,
  view,
  onViewChange,
  readOnly,
  onRename,
  onAddStep,
  onUpload,
  patternOpen,
  onLink,
  onFromReferences,
  staleCount,
  poseAgainCount,
  refreshing,
  onRefreshAll,
  onStopRefreshing,
  onExport,
  drawerSlot,
}: {
  title: string;
  stepCount: number;
  /** How many pages the steps make. */
  pageCount: number;
  view: DiagramViewMode;
  onViewChange: (view: DiagramViewMode) => void;
  readOnly: boolean;
  onRename: (title: string) => void;
  onAddStep: () => void;
  /** Pick pictures, each a step. Called from the menu row itself. */
  onUpload: () => void;
  /** A crease pattern is open to link a step to. */
  patternOpen: boolean;
  /** Add a step and choose its pattern. */
  onLink: () => void;
  /** Open the References browser, adding after the selected step or at the end. */
  onFromReferences: () => void;
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
  /** Where the touch layer seats the Step pane's pill (`viewDrawerSlot`). */
  drawerSlot: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  return (
    <div className={`panel-toolbar ${styles.header}`}>
      <div className={styles.side}>
        <div className={`panel-toolbar__group ${styles.title}`}>
          <DiagramTitleField
            title={title}
            disabled={readOnly}
            onRename={onRename}
          />
          {stepCount > 0 && (
            <span className={styles.count}>
              {t("panels:diagram.header.stepCount", {
                count: stepCount,
                defaultValue_one: "1 step",
                defaultValue_other: "{{count}} steps",
              })}
              {" · "}
              {t("panels:diagram.header.pageCount", {
                count: pageCount,
                defaultValue_one: "1 page",
                defaultValue_other: "{{count}} pages",
              })}
            </span>
          )}
        </div>
      </div>
      <DiagramViewSwitch
        className={styles.views}
        view={view}
        onChange={onViewChange}
      />
      <div className={styles.side} data-side="end">
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
                onSelect: onFromReferences,
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
