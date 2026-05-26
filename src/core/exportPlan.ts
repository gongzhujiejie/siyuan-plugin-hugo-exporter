/**
 * 文件用途：生成 dry-run 与真实写入共用的导出 manifest。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：无运行时依赖。
 */
import type { AssetCopyPlan, BundlePaths, ExportManifest } from "./types";

interface CreateExportManifestInput {
  docId: string;
  paths: BundlePaths;
  dryRun: boolean;
  now: string;
  assetPlans: AssetCopyPlan[];
  skippedAssets: string[];
  warnings: string[];
}

/**
 * normalizeRunIdTime 生成跨平台稳定 runId 时间片段。
 * 输入：ISO datetime。
 * 返回：只含数字与 T 的短时间字符串。
 */
function normalizeRunIdTime(now: string): string {
  return now.replace(/[-:]/g, "").replace(/\.\d+/, "").replace(/\+.*$/, "").replace(/Z$/, "");
}

/** parentDir 从相对文件路径中取父目录。 */
function parentDir(relativePath: string): string {
  const parts = relativePath.split("/");
  parts.pop();
  return parts.join("/");
}

/** unique 保持输入顺序去重，避免 manifest 目录重复。 */
function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * createExportManifest 生成导出计划。
 * 输入：文档 ID、路径、dry-run 标记、资源计划、当前时间、警告列表。
 * 返回：包含计划目录、计划写入文件与资源复制结果的 manifest。
 */
export function createExportManifest(input: CreateExportManifestInput): ExportManifest {
  const assetTargets = input.assetPlans.map((asset) => asset.targetRelativePath);
  const plannedWrites = [input.paths.relativeIndexPath, ...assetTargets];
  const plannedDirectories = unique([parentDir(input.paths.relativeIndexPath), input.paths.relativeAssetDir]);

  return {
    runId: `${normalizeRunIdTime(input.now)}-${input.docId}`,
    dryRun: input.dryRun,
    docId: input.docId,
    slug: input.paths.slug,
    target: input.paths.relativeIndexPath,
    plannedWrites,
    plannedDirectories,
    copiedAssets: assetTargets,
    skippedAssets: input.skippedAssets,
    warnings: input.warnings,
    createdAt: input.now,
  };
}
