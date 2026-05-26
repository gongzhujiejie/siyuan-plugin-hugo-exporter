/**
 * 文件用途：封装 M1/M2 的文件写入与资源复制行为。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-26
 * 语言版本：TypeScript 5.x
 * 依赖库：Node fs/promises、node:path。
 *
 * 安全说明：
 * - 写文件：路径解析后必须仍在 repoRoot 内。
 * - 复制资源：源文件路径解析后必须仍在 assetBasePath 内（防御 markdown 指向系统文件）；
 *   目标路径解析后必须仍在 repoRoot 内（防御 ../ 跳出 leaf bundle）。
 */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { AssetCopyPlan } from "../core/types";

interface WriteExportedIndexInput {
  repoRoot: string;
  relativeIndexPath: string;
  content: string;
  dryRun: boolean;
}

interface WriteExportedIndexResult {
  written: boolean;
  absolutePath: string;
}

interface CopyExportedAssetsInput {
  repoRoot: string;
  dryRun: boolean;
  assetPlans: AssetCopyPlan[];
  /** assetBasePath 是允许读取源文件的根目录；为空时回退到 repoRoot 同目录的家根。 */
  assetBasePath?: string;
  /** concurrency 并发复制上限；不传默认 8。 */
  concurrency?: number;
  /** onProgress 每完成一个文件回调一次，用于在进度对话框里实时刷新。 */
  onProgress?: (done: number, total: number) => void;
}

interface CopyExportedAssetsResult {
  copied: string[];
  skipped: string[];
  warnings: string[];
}

/** ensureInsideBoundary 防止给定路径通过 ../ 逃逸约束目录。返回 true 代表合法。 */
function ensureInsideBoundary(rootDir: string, absolutePath: string): boolean {
  const root = resolve(rootDir);
  const target = resolve(absolutePath);
  const rel = relative(root, target);
  if (rel === "" || rel === ".") return false;
  if (rel.startsWith("..")) return false;
  if (isAbsolute(rel)) return false;
  return true;
}

/** ensureInsideRepo 在不合法时抛错，保留原行为。 */
function ensureInsideRepo(repoRoot: string, absolutePath: string): void {
  if (!ensureInsideBoundary(repoRoot, absolutePath)) {
    throw new Error(`Refuse to write outside repository: ${resolve(absolutePath)}`);
  }
}

/**
 * writeExportedIndex 写入 Hugo leaf bundle 的 index.md。
 * 输入：仓库根目录、相对 index 路径、文件内容、dry-run 标记。
 * 返回：是否真实写入，以及绝对路径。
 */
export async function writeExportedIndex(input: WriteExportedIndexInput): Promise<WriteExportedIndexResult> {
  const absolutePath = join(input.repoRoot, input.relativeIndexPath);
  ensureInsideRepo(input.repoRoot, absolutePath);

  if (input.dryRun) {
    return { written: false, absolutePath };
  }

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, input.content, "utf8");
  return { written: true, absolutePath };
}

/**
 * copyExportedAssets 根据 assetPlans 并发复制资源到 Hugo images 目录。
 * 输入：仓库根目录、dry-run 标记、资源复制计划、可选 assetBasePath / concurrency / onProgress。
 * 返回：已复制、已跳过资源和警告列表（顺序按 plan 输入顺序，不受并发影响）。
 *
 * 安全说明：
 * - 源文件解析后若不在 assetBasePath 内，记入 warnings 并跳过，不读取该文件。
 * - 目标解析后若不在 repoRoot 内，直接抛错（这是程序 bug，不应静默吞）。
 */
export async function copyExportedAssets(input: CopyExportedAssetsInput): Promise<CopyExportedAssetsResult> {
  const total = input.assetPlans.length;
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 8, total || 1));
  const results: ("copied" | "skipped")[] = new Array(total);
  const warningSlots: (string | null)[] = new Array(total).fill(null);
  let completed = 0;

  const reportProgress = (): void => {
    completed += 1;
    input.onProgress?.(completed, total);
  };

  const runOne = async (idx: number): Promise<void> => {
    const plan = input.assetPlans[idx];
    const targetPath = join(input.repoRoot, plan.targetRelativePath);
    ensureInsideRepo(input.repoRoot, targetPath);

    if (input.dryRun) {
      results[idx] = "skipped";
      reportProgress();
      return;
    }

    if (input.assetBasePath && !ensureInsideBoundary(input.assetBasePath, plan.sourcePath)) {
      // NOTE: 来源在 assetBasePath 之外（例如 markdown 故意写成 ../../C:/Windows/...）→ 拒绝读取。
      results[idx] = "skipped";
      warningSlots[idx] = `Refuse to copy asset outside assetBasePath: ${plan.sourcePath}`;
      reportProgress();
      return;
    }

    try {
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(plan.sourcePath, targetPath);
      results[idx] = "copied";
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown copy error";
      results[idx] = "skipped";
      warningSlots[idx] = `Missing asset source or copy failed: ${plan.sourcePath}; ${message}`;
    } finally {
      reportProgress();
    }
  };

  // 简易并发限流：用游标 + N 个 worker 取任务。
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < concurrency; w += 1) {
    workers.push(
      (async () => {
        while (true) {
          const idx = cursor;
          cursor += 1;
          if (idx >= total) return;
          await runOne(idx);
        }
      })(),
    );
  }
  await Promise.all(workers);

  const copied: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const plan = input.assetPlans[i];
    if (results[i] === "copied") copied.push(plan.targetRelativePath);
    else skipped.push(plan.targetRelativePath);
    if (warningSlots[i]) warnings.push(warningSlots[i] as string);
  }
  return { copied, skipped, warnings };
}
