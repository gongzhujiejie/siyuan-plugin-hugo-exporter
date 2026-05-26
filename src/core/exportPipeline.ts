/**
 * 文件用途：编排 Hugo 导出流程，生成 index.md 内容、资源复制计划与 dry-run manifest。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：项目内部 core 模块。
 */
import { FIXIT_BLOG_PRESET } from "../presets/fixitBlog";
import type { ExportInput, ExportResult, ResourcePolicy } from "./types";
import { planMarkdownAssets } from "./assets";
import { createExportManifest } from "./exportPlan";
import { buildFrontmatter, renderFrontmatterYaml } from "./frontmatter";
import { composeHugoMarkdown, stripExistingFrontmatter } from "./markdown";
import { buildBundlePaths } from "./slug";

const DEFAULT_RESOURCE_POLICY: ResourcePolicy = {
  assetDirName: "images",
  filenameStrategy: "keep",
  conflictStrategy: "rename",
  rewriteMarkdownLinks: true,
};

/**
 * exportHugoPost 是 M2 的纯函数导出核心。
 * 输入：思源文档快照、目标仓库路径、可选 slug、dry-run 标记、资源根路径和当前时间。
 * 返回：导出结果、manifest、index.md 内容，以及资源复制计划。
 */
export function exportHugoPost(input: ExportInput): ExportResult {
  try {
    const paths = buildBundlePaths(input.repoRoot, input.slug ?? input.doc.title, FIXIT_BLOG_PRESET, {
      contentDir: input.contentDir,
      assetSubDir: input.assetSubDir,
    });
    const policy = input.resourcePolicy ?? {
      ...DEFAULT_RESOURCE_POLICY,
      assetDirName: input.assetSubDir?.trim() || DEFAULT_RESOURCE_POLICY.assetDirName,
    };
    const bodyWithoutFrontmatter = stripExistingFrontmatter(input.doc.markdown);
    const assetBasePath = input.assetBasePath ?? input.repoRoot;
    const assetResult = policy.rewriteMarkdownLinks
      ? planMarkdownAssets({
          markdown: bodyWithoutFrontmatter,
          assetBasePath,
          relativeAssetDir: paths.relativeAssetDir,
          publicAssetDir: policy.assetDirName,
          existingTargetNames: new Set(),
        })
      : { markdown: bodyWithoutFrontmatter, assetPlans: [], warnings: [] };

    const frontmatter = input.frontmatterOverride ?? buildFrontmatter(input.doc, FIXIT_BLOG_PRESET);
    const frontmatterYaml = renderFrontmatterYaml(frontmatter);
    const content = composeHugoMarkdown(frontmatterYaml, assetResult.markdown);
    const manifest = createExportManifest({
      docId: input.doc.id,
      paths,
      dryRun: input.dryRun,
      now: input.now,
      assetPlans: assetResult.assetPlans,
      skippedAssets: [],
      warnings: assetResult.warnings,
    });

    return {
      ok: true,
      dryRun: input.dryRun,
      manifest,
      content,
      assetPlans: assetResult.assetPlans,
      errors: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown export error";
    const fallbackPaths = buildBundlePaths(input.repoRoot, "untitled", FIXIT_BLOG_PRESET, {
      contentDir: input.contentDir,
      assetSubDir: input.assetSubDir,
    });
    const manifest = createExportManifest({
      docId: input.doc.id,
      paths: fallbackPaths,
      dryRun: input.dryRun,
      now: input.now,
      assetPlans: [],
      skippedAssets: [],
      warnings: [message],
    });

    return {
      ok: false,
      dryRun: input.dryRun,
      manifest,
      assetPlans: [],
      errors: [message],
    };
  }
}
