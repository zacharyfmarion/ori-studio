import { attachWorkerDiagnostics } from "../../lib/workerDiagnostics";
import * as Comlink from "comlink";
import { bucketCount, COUNT_BUCKETS, track, trackDiagramPictureUploaded } from "../../analytics";
import i18n from "../../i18n";
import { type PickedFile } from "../../platform/fileService";
import { useWorkspaceStore } from "../../store/workspaceStore";
import {
  type ImportGroup,
  type ImportTarget,
  commitDiagramImport,
} from "../../store/workspaceStore/diagramBatchImport";
import {
  createDiagram,
  createStep,
  randomDiagramId,
  uploadStepParts,
} from "../document/diagramDocument";
import { assetFrom, failureReason, STEP_PICTURE_EXTENSIONS, uploadOutcome } from "../upload/addStepPictures";
import { importStepPicture } from "../upload/importStepPicture";
import type { SanitizeNotice } from "../upload/svgSanitize";
import { CpImportPreparer, type PreparedCp } from "./prepareCp";
import { DEFOX_LIMITS } from "./defoxLimits";
import type { DefoxImportWorkerApi } from "../../workers/defoxImportWorker";

export interface ImportProgress {
  done: number;
  total: number;
  phase: "reading" | "preparing" | "placing" | "done";
  name: string;
  failures: { name: string; message: string }[];
  notices: { name: string; message: string }[];
  added?: number;
}
const CP_FILE = /\.cp$/i;
const DEFOX_FILE = /\.defox$/i;
const PICTURE_FILE = new RegExp(`\\.(?:${STEP_PICTURE_EXTENSIONS.join("|")})$`, "i");
/** What the picker offers: crease patterns, a Defox project, and every picture the step uploader takes. */
export const STEP_IMPORT_EXTENSIONS = ["cp", "defox", ...STEP_PICTURE_EXTENSIONS];
export const supportsStepImport = (name: string) =>
  CP_FILE.test(name) || DEFOX_FILE.test(name) || PICTURE_FILE.test(name);
export function orderedImportFiles(files: readonly PickedFile[]): PickedFile[] {
  const order = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return files
    .map((file, index) => ({ file, index }))
    .sort(
      (a, b) =>
        order.compare(a.file.name, b.file.name) ||
        a.file.name.localeCompare(b.file.name) ||
        a.index - b.index,
    )
    .map((v) => v.file);
}
class ImportBudgetError extends Error {}
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e !== null && "message" in e
      ? String(e.message)
      : String(e);
const MiB = 1024 * 1024;
/** Staging is job-local. Cancellation never reaches the live document. */
export async function runImportJob(
  files: readonly PickedFile[],
  target: ImportTarget,
  options: { columns: number; gap: number; foldTimeoutMs: number },
  signal: AbortSignal,
  foldSignal: AbortSignal,
  onProgress: (p: ImportProgress) => void,
): Promise<ImportProgress> {
  const t = i18n.t;
  if (files.length > 1000)
    throw new Error(t("panels:diagram.import.tooManyFiles", "Choose at most 1,000 files."));
  const defoxFiles = files.filter((f) => DEFOX_FILE.test(f.name));
  if (defoxFiles.length && files.length !== 1)
    throw new Error(
      t(
        "panels:diagram.import.oneDefox",
        "Import one Defox project at a time, separately from other files.",
      ),
    );
  const progress: ImportProgress = {
    done: 0,
    total: files.length,
    phase: "reading",
    name: "",
    failures: [],
    notices: [],
  };
  const publish = () =>
    onProgress({
      ...progress,
      failures: [...progress.failures],
      notices: [...progress.notices],
    });
  if (
    target.cpLoadSerial === null &&
    files.some((file) => CP_FILE.test(file.name) || DEFOX_FILE.test(file.name))
  ) {
    throw new Error(
      t(
        "panels:diagram.import.openEditFirst",
        "Open the Edit workspace once before importing crease patterns.",
      ),
    );
  }
  const preparer = new CpImportPreparer(),
    groups: ImportGroup[] = [];
  const style = (target.diagram ?? createDiagram()).style;
  const cache = new Map<string, PreparedCp>();
  /** What sanitizing changed in each staged picture, recorded once it is in the diagram. */
  const pictureNotices = new Map<string, SanitizeNotice[]>();
  let cacheBytes = 0,
    readBytes = 0,
    stagedBytes = 0;
  const yieldUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const countRead = (bytes: number) => {
    readBytes += bytes;
    if (readBytes > 256 * MiB)
      throw new ImportBudgetError(
        t(
          "panels:diagram.import.batchTooLarge",
          "These files add up to more than 256 MiB. Import a smaller batch.",
        ),
      );
  };
  const read = async (file: PickedFile, limit: number) => {
    const bytes = await file.read(limit);
    countRead(bytes.byteLength);
    return bytes;
  };
  let worker: Worker | undefined;
  const check = () => {
    if (signal.aborted)
      throw new DOMException("Import cancelled", "AbortError");
  };
  try {
    for (const file of files) {
      check();
      progress.name = file.name;
      progress.phase = "reading";
      publish();
      await yieldUi();
      try {
        if (PICTURE_FILE.test(file.name)) {
          progress.phase = "preparing";
          publish();
          // The step uploader's own path: its size caps, sanitizer, stored
          // asset and step parts, so an imported picture is an uploaded one.
          const id = randomDiagramId("asset");
          const result = await importStepPicture(file, id);
          trackDiagramPictureUploaded(result.format, uploadOutcome(result), result.fileBytes, files.length);
          countRead(result.fileBytes ?? 0);
          check();
          if (!result.ok) throw new Error(failureReason(result.reason));
          const asset = assetFrom(id, result);
          groups.push({ steps: [{ ...createStep(), ...uploadStepParts(asset) }], assets: [asset] });
          stagedBytes += result.bytes;
          if (result.notices.length) {
            pictureNotices.set(id, result.notices);
            progress.notices.push({
              name: file.name,
              message: t(
                "panels:diagram.import.sanitized",
                "The SVG was sanitized: unsupported or external content was removed.",
              ),
            });
          }
        } else if (DEFOX_FILE.test(file.name)) {
          const bytes = await read(file, DEFOX_LIMITS.fileBytes);
          check();
          progress.phase = "preparing";
          publish();
          worker = new Worker(
            new URL("../../workers/defoxImportWorker.ts", import.meta.url),
            {
              type: "module",
            },
          );
          let failed: (error: Error) => void = () => undefined;
          const crashed = new Promise<never>((_, reject) => {
            failed = reject;
          });
          const detach = attachWorkerDiagnostics(
            worker,
            "defox-import",
            (info) => failed(new Error(info.message)),
          );
          const api = Comlink.wrap<DefoxImportWorkerApi>(worker);
          let stop: (error: Error) => void = () => undefined;
          const stopped = new Promise<never>((_, reject) => {
            stop = (error) => {
              worker?.terminate();
              reject(error);
            };
          });
          const cancel = () => stop(new DOMException("Import cancelled", "AbortError"));
          signal.addEventListener("abort", cancel, { once: true });
          // Not a cancel: said as what it is, and the run goes on to report it.
          const timer = setTimeout(
            () =>
              stop(
                new Error(
                  t(
                    "panels:diagram.import.defoxTimeout",
                    "Reading the Defox project took longer than 30 seconds.",
                  ),
                ),
              ),
            30_000,
          );
          const entries = await Promise.race([
            // Moved, not copied: the worker reads the file where it lies.
            api.renderDefox(Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer])),
            stopped,
            crashed,
          ]).finally(() => {
            detach();
            clearTimeout(timer);
            signal.removeEventListener("abort", cancel);
            worker?.terminate();
            worker = undefined;
          });
          progress.total = entries.length;
          for (const entry of entries) {
            check();
            const name = `${file.name} · ${entry.index + 1}`;
            progress.name = name;
            publish();
            await yieldUi();
            if (!entry.ok)
              progress.failures.push({
                name,
                message: t(
                  "panels:diagram.import.defoxEntryFailed",
                  "This saved view couldn’t be read ({{reason}}).",
                  { reason: entry.error },
                ),
              });
            else {
              try {
                const result = await preparer.prepare(
                  entry.cp,
                  name,
                  style,
                  signal,
                  foldSignal,
                  options.foldTimeoutMs,
                  entry,
                );
                groups.push(result);
                stagedBytes +=
                  entry.svg.length +
                  entry.snapshot.length +
                  result.geometry.segEndpoints.byteLength;
                for (const message of result.notices)
                  progress.notices.push({ name, message });
              } catch (e) {
                check();
                progress.failures.push({ name, message: errorText(e) });
              }
            }
            progress.done++;
            publish();
          }
        } else if (CP_FILE.test(file.name)) {
          const bytes = await read(file, 16 * MiB);
          check();
          progress.phase = "preparing";
          publish();
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          const cached = cache.get(text);
          const result = cached
            ? {
                ...cached,
                steps: cached.steps.map((step) => ({
                  ...step,
                  id: randomDiagramId("step"),
                })),
              }
            : await preparer.prepare(
                text,
                file.name,
                style,
                signal,
                foldSignal,
                options.foldTimeoutMs,
              );
          groups.push(result);
          const cost =
            bytes.byteLength +
            result.geometry.segEndpoints.byteLength +
            JSON.stringify(result.steps).length * 2 +
            JSON.stringify(result.assets).length * 2;
          stagedBytes += cost;
          if (
            !cached &&
            result.steps.every((s) => s.importStatus !== "failed") &&
            cost + cacheBytes <= 64 * MiB
          ) {
            cache.set(text, result);
            cacheBytes += cost;
          }
          for (const message of result.notices)
            progress.notices.push({ name: file.name, message });
        } else
          throw new Error(
            t("panels:diagram.import.unsupported", "Choose crease patterns, a Defox project or pictures."),
          );
      } catch (e) {
        check();
        if (e instanceof ImportBudgetError) throw e;
        progress.failures.push({ name: file.name, message: errorText(e) });
      }
      if (stagedBytes > 384 * MiB)
        throw new Error(
          t(
            "panels:diagram.import.preparedTooLarge",
            "The prepared steps exceed 384 MiB. Import a smaller batch.",
          ),
        );
      if (!defoxFiles.length) progress.done++;
      publish();
    }
    check();
    progress.phase = "placing";
    progress.name = "";
    publish();
    await yieldUi();
    check();
    progress.added = await commitDiagramImport(
      groups,
      target,
      options.columns,
      options.gap,
    );
    // As an upload records them, for the Step pane: what sanitizing changed in each picture.
    if (progress.added > 0) {
      const store = useWorkspaceStore.getState();
      for (const [id, notices] of pictureNotices) store.noteDiagramPictureChanges(id, notices);
    }
    progress.phase = "done";
    publish();
    track("diagram import completed", {
      format: defoxFiles.length
        ? "defox"
        : files.every((f) => PICTURE_FILE.test(f.name))
          ? "pictures"
          : "batch",
      count: bucketCount(progress.added, COUNT_BUCKETS),
      failures: bucketCount(progress.failures.length, COUNT_BUCKETS),
    });
    return progress;
  } finally {
    worker?.terminate();
    cache.clear();
    await preparer.close();
  }
}
