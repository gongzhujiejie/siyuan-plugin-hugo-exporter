/**
 * 文件用途：生成 Hugo 文章 slug，并构造安全的 leaf bundle 路径。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：无运行时依赖。
 */
import type { BundlePaths, RepositoryPreset } from "./types";

const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/**
 * 将思源文档标题转换为 Hugo 可用 slug。
 * 输入：任意文档标题。
 * 返回：只包含中文、英文、数字、下划线和短横线的安全 slug。
 */
export function slugifyTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[\\/]+/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{Script=Han}a-z0-9_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized || normalized === "." || normalized === "..") {
    return "untitled";
  }

  if (WINDOWS_RESERVED_NAMES.has(normalized)) {
    return `${normalized}-post`;
  }

  return normalized;
}

/**
 * validateSlug 阻止路径穿越与 Windows 保留名。
 * 输入：候选 slug。
 * 异常：slug 含危险路径片段时抛出 Error。
 */
export function validateSlug(slug: string): void {
  if (!slug || slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
    throw new Error(`Unsafe slug: ${slug}`);
  }

  if (WINDOWS_RESERVED_NAMES.has(slug.toLowerCase())) {
    throw new Error(`Unsafe slug: ${slug}`);
  }
}

/**
 * assertNoTraversalPattern 在 slugify 前阻断明确路径穿越输入。
 * 这样普通标题里的斜杠仍会被安全转为短横线，但 ../../evil 会被拒绝。
 */
function assertNoTraversalPattern(raw: string): void {
  if (raw.includes("..") || raw.includes("/../") || raw.includes("\\..\\")) {
    throw new Error(`Unsafe slug: ${raw}`);
  }
}

/**
 * joinPortable 使用正斜杠拼接路径，避免测试和 manifest 在 Windows/Linux 间产生不稳定 diff。
 */
function joinPortable(...parts: string[]): string {
  return parts
    .map((part) => part.replaceAll("\\", "/").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

/** BundlePathsOverride 允许导出管线覆盖预设的内容目录与资源子目录。 */
export interface BundlePathsOverride {
  /** contentDir 是相对仓库根的内容目录，例如 content/posts 或 content/post。 */
  contentDir?: string;
  /** assetSubDir 是 leaf bundle 内的资源子目录名，例如 images。 */
  assetSubDir?: string;
}

/**
 * buildBundlePaths 构造 <contentDir>/<slug>/index.md 与资源目录路径。
 * 输入：仓库根目录、候选 slug/标题、仓库预设、可选覆盖。
 * 返回：Hugo leaf bundle 路径集合。
 */
export function buildBundlePaths(
  repoRoot: string,
  slugOrTitle: string,
  preset: RepositoryPreset,
  override: BundlePathsOverride = {},
): BundlePaths {
  assertNoTraversalPattern(slugOrTitle);
  const slug = slugifyTitle(slugOrTitle);
  validateSlug(slug);

  // NOTE: 当用户填 content/post 时，把它整体作为内容目录，不再叠加 preset.postsDir。
  const contentDir = override.contentDir?.trim()
    ? override.contentDir.trim()
    : joinPortable(preset.contentDir, preset.postsDir);
  const assetSubDir = override.assetSubDir?.trim() ? override.assetSubDir.trim() : preset.assetDirName;

  const relativeBundleDir = joinPortable(contentDir, slug);
  const relativeAssetDir = joinPortable(relativeBundleDir, assetSubDir);
  const relativeIndexPath = joinPortable(relativeBundleDir, preset.bundleIndexName);
  const normalizedRoot = repoRoot.replaceAll("\\", "/").replace(/\/+$/g, "");

  return {
    slug,
    bundleDir: joinPortable(normalizedRoot, relativeBundleDir),
    indexPath: joinPortable(normalizedRoot, relativeIndexPath),
    relativeIndexPath,
    relativeBundleDir,
    relativeAssetDir,
  };
}
