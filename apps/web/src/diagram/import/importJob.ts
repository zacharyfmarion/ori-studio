import { attachWorkerDiagnostics } from "../../lib/workerDiagnostics";
import * as Comlink from "comlink";
import { bucketCount, COUNT_BUCKETS, track } from "../../analytics";
import { type PickedFile } from "../../platform/fileService";
import {
  type ImportGroup,
  type ImportTarget,
  commitDiagramImport,
} from "../../store/workspaceStore/diagramBatchImport";
import {
  createDiagram,
  createStep,
  randomDiagramId,
} from "../document/diagramDocument";
import { importStepPicture } from "../upload/importStepPicture";
import { CpImportPreparer, type PreparedCp } from "./prepareCp";
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
export const supportsStepImport = (name: string) =>
  /\.(cp|svg|defox)$/i.test(name);
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
/** Staging is job-local. Cancellation never reaches the live document. */
export async function runImportJob(
  files: readonly PickedFile[],
  target: ImportTarget,
  options: { columns: number; gap: number; foldTimeoutMs: number },
  signal: AbortSignal,
  foldSignal: AbortSignal,
  onProgress: (p: ImportProgress) => void,
): Promise<ImportProgress> {
  if (files.length > 1000) throw new Error("Choose at most 1000 files.");
  const defoxFiles = files.filter((f) => /\.defox$/i.test(f.name));
  if (defoxFiles.length && files.length !== 1)
    throw new Error(
      "Import one Defox project at a time, separately from CP/SVG files.",
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
    files.some((file) => /\.(cp|defox)$/i.test(file.name))
  ) {
    throw new Error(
      "Open the Edit workspace once before importing crease patterns.",
    );
  }
  const preparer = new CpImportPreparer(),
    groups: ImportGroup[] = [];
  const style = (target.diagram ?? createDiagram()).style;
  const cache = new Map<string, PreparedCp>();
  let cacheBytes = 0,
    readBytes = 0,
    stagedBytes = 0;
  const yieldUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
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
        const bytes = await file.read(
          /\.defox$/i.test(file.name) ? 64 * 1024 * 1024 : 16 * 1024 * 1024,
        );
        readBytes += bytes.byteLength;
        if (readBytes > 256 * 1024 * 1024)
          throw new ImportBudgetError("Batch exceeds 256 MiB");
        check();
        progress.phase = "preparing";
        publish();
        if (/\.svg$/i.test(file.name)) {
          const id = randomDiagramId("asset");
          const result = await importStepPicture(
            { ...file, read: async () => bytes },
            id,
          );
          if (!result.ok || result.content.kind !== "svg")
            throw new Error(!result.ok ? result.reason : "Expected an SVG");
          const asset = {
            id,
            kind: "svg" as const,
            svg: result.content.svg,
            widthPx: result.content.widthPx,
            heightPx: result.content.heightPx,
            bytes: result.bytes,
          };
          groups.push({
            steps: [
              {
                ...createStep(),
                source: {
                  kind: "upload",
                  assetId: id,
                  rotationQuarterTurns: 0,
                  mirrored: false,
                },
                picture: {
                  kind: "asset",
                  assetId: id,
                  paperScale: null,
                  key: id,
                },
              },
            ],
            assets: [asset],
          });
          stagedBytes += result.bytes;
          if (result.notices.length)
            progress.notices.push({
              name: file.name,
              message:
                "The SVG was sanitized; unsupported or external content was removed.",
            });
        } else if (/\.defox$/i.test(file.name)) {
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
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          let cancel: () => void = () => undefined;
          const stopped = new Promise<never>((_, reject) => {
            cancel = () => {
              worker?.terminate();
              reject(new DOMException("Import cancelled", "AbortError"));
            };
            signal.addEventListener("abort", cancel, { once: true });
          });
          const timer = setTimeout(cancel, 30_000);
          const entries = await Promise.race([
            api.renderDefox(text),
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
              progress.failures.push({ name, message: entry.error });
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
        } else if (/\.cp$/i.test(file.name)) {
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
            cost + cacheBytes <= 64 * 1024 * 1024
          ) {
            cache.set(text, result);
            cacheBytes += cost;
          }
          for (const message of result.notices)
            progress.notices.push({ name: file.name, message });
        } else throw new Error("Unsupported file. Choose CP, SVG or Defox.");
      } catch (e) {
        check();
        if (e instanceof ImportBudgetError) throw e;
        progress.failures.push({ name: file.name, message: errorText(e) });
      }
      if (stagedBytes > 384 * 1024 * 1024)
        throw new Error(
          "Prepared import exceeds the 384 MiB prepared-content limit. Import a smaller batch.",
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
    progress.phase = "done";
    publish();
    track("diagram import completed", {
      format: defoxFiles.length
        ? "defox"
        : files.every((f) => /\.svg$/i.test(f.name))
          ? "svg"
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
