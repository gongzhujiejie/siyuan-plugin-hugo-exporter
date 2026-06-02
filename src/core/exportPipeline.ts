/**
 * 文件用途：编排 Hugo 导出流程，生成 index.md 内容、资源复制计划与 dry-run manifest。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-31
 * 语言版本：TypeScript 5.x
 * 依赖库：项目内部 core 模块。
 */
import { FIXIT_BLOG_PRESET } from "../presets/fixitBlog";
import type { AssetCopyPlan, ExportInput, ExportResult, ResourcePolicy } from "./types";
import { planFrontmatterImageAsset, planMarkdownAssets } from "./assets";
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
 * FRONTMATTER_IMAGE_FIELDS 列出会被自动当作"本地图片"处理的 frontmatter 字段。
 *
 * 处理规则：
 * - 字段值若是远端 URL：保留不动；
 * - 字段值若是 bundle 内相对路径（如 images/cover.png）：保留不动（旧文章兼容）；
 * - 字段值若是 file:// / Windows 绝对路径 / 思源 assets/...：自动复制到 bundle 的 images/ 下，
 *   并把 frontmatter 重写为 images/<final-name>。
 *
 * NOTE: 暂不处理 images: ["xxx.png"] 这种数组字段（FixIt 用于 Open Graph）；如果以后要支持，
 *       在这里把数组分别处理一遍即可。
 */
const FRONTMATTER_IMAGE_FIELDS = ["featuredImage", "featuredImagePreview"] as const;

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

    // 取一份可变 frontmatter 副本：本环节会改写其中的 featuredImage / featuredImagePreview 字段值。
    const frontmatter: Record<string, unknown> = input.frontmatterOverride
      ? { ...input.frontmatterOverride }
      : { ...buildFrontmatter(input.doc, FIXIT_BLOG_PRESET) };

    // NOTE: 把 markdown 里已经占用的目标文件名收集起来，避免 featuredImage 拷贝时和正文图片冲突。
    const usedTargetNames = new Set<string>(
      assetResult.assetPlans.map((plan) => plan.targetRelativePath.split("/").at(-1) ?? ""),
    );
    const extraAssetPlans: AssetCopyPlan[] = [];
    const frontmatterWarnings: string[] = [];

    for (const fieldKey of FRONTMATTER_IMAGE_FIELDS) {
      const raw = frontmatter[fieldKey];
      if (typeof raw !== "string" || !raw.trim()) continue;
      const planResult = planFrontmatterImageAsset({
        rawValue: raw,
        assetBasePath,
        relativeAssetDir: paths.relativeAssetDir,
        publicAssetDir: policy.assetDirName,
        existingTargetNames: usedTargetNames,
      });
      // 只有真的产生 plan 才把目标名占住，避免影响其他字段。
      if (planResult.assetPlan) {
        extraAssetPlans.push(planResult.assetPlan);
        const finalName = planResult.assetPlan.targetRelativePath.split("/").at(-1) ?? "";
        if (finalName) usedTargetNames.add(finalName);
      }
      if (planResult.rewrittenValue) {
        frontmatter[fieldKey] = planResult.rewrittenValue;
      } else {
        delete frontmatter[fieldKey];
      }
      for (const warn of planResult.warnings) {
        frontmatterWarnings.push(`[${fieldKey}] ${warn}`);
      }
    }

    const allAssetPlans = [...assetResult.assetPlans, ...extraAssetPlans];
    const allWarnings = [...assetResult.warnings, ...frontmatterWarnings];

    const frontmatterYaml = renderFrontmatterYaml(frontmatter);
    const content = composeHugoMarkdown(frontmatterYaml, assetResult.markdown);
    const manifest = createExportManifest({
      docId: input.doc.id,
      paths,
      dryRun: input.dryRun,
      now: input.now,
      assetPlans: allAssetPlans,
      skippedAssets: [],
      warnings: allWarnings,
    });

    return {
      ok: true,
      dryRun: input.dryRun,
      manifest,
      content,
      assetPlans: allAssetPlans,
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
