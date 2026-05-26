/**
 * 文件用途：封装 M1/M2 的文件写入与资源复制行为。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：Node fs/promises、node:path。
 *
 * 安全说明：这里只写入 manifest 指定的相对路径，并检查解析后的目标仍在 repoRoot 内。
 */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
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
}

interface CopyExportedAssetsResult {
  copied: string[];
  skipped: string[];
  warnings: string[];
}

/** ensureInsideRepo 防止 relativeIndexPath 通过 ../ 逃逸仓库根目录。 */
function ensureInsideRepo(repoRoot: string, absolutePath: string): void {
  const root = resolve(repoRoot);
  const target = resolve(absolutePath);
  const rel = relative(root, target);

  if (rel.startsWith("..") || rel === ".." || resolve(rel) === rel) {
    throw new Error(`Refuse to write outside repository: ${target}`);
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
 * copyExportedAssets 根据 assetPlans 复制资源到 Hugo images 目录。
 * 输入：仓库根目录、dry-run 标记、资源复制计划。
 * 返回：已复制、已跳过资源和警告列表。
 */
export async function copyExportedAssets(input: CopyExportedAssetsInput): Promise<CopyExportedAssetsResult> {
  const copied: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  for (const plan of input.assetPlans) {
    const targetPath = join(input.repoRoot, plan.targetRelativePath);
    ensureInsideRepo(input.repoRoot, targetPath);

    if (input.dryRun) {
      skipped.push(plan.targetRelativePath);
      continue;
    }

    try {
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(plan.sourcePath, targetPath);
      copied.push(plan.targetRelativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown copy error";
      skipped.push(plan.targetRelativePath);
      warnings.push(`Missing asset source or copy failed: ${plan.sourcePath}; ${message}`);
    }
  }

  return { copied, skipped, warnings };
}
