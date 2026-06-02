/**
 * 文件用途：提供 Hugo 博客文章扫描、上下架 frontmatter 修改与删除计划生成能力。
 * 创建日期：2026-06-02
 * 语言版本：TypeScript 5.x
 * 依赖库：js-yaml
 */
import path from "node:path";
import yaml from "js-yaml";

/** BlogPostStatus 描述博客文章在站点中的发布状态。 */
export type BlogPostStatus = "published" | "unpublished";

/** BlogFileReader 抽象文件系统访问，便于测试和未来接入真实仓库适配器。 */
export interface BlogFileReader {
  /** listFiles 返回仓库内文件路径列表；路径可为相对路径，也可包含 Windows 反斜杠。 */
  listFiles: () => string[] | Promise<string[]>;
  /** readFile 读取指定相对路径的文本内容；调用方保证路径来自 listFiles。 */
  readFile: (relativePath: string) => string | Promise<string>;
}

/** ScanBlogPostsInput 是扫描 Hugo leaf bundle 时需要的最小输入。 */
export interface ScanBlogPostsInput {
  /** repoRoot 保留给真实文件系统适配器使用；核心逻辑只处理 reader 暴露出的相对路径。 */
  repoRoot: string;
  /** contentDir 是 Hugo 内容目录，例如 content/posts。 */
  contentDir: string;
  /** reader 是外部注入的文件列表/读取器，避免核心逻辑直接触碰磁盘。 */
  reader: BlogFileReader;
}

/** BlogPostEntry 是文章管理列表展示所需的核心文章元数据。 */
export interface BlogPostEntry {
  title: string;
  date?: string;
  categories: string[];
  tags: string[];
  draft: boolean;
  slug?: string;
  status: BlogPostStatus;
  bundleDir: string;
  indexPath: string;
}

/** DeleteBundlePlan 描述删除 leaf bundle 时要删除的目录路径。 */
export interface DeleteBundlePlan {
  /** bundleDir 是相对 repoRoot 的安全目录路径，可直接交给上层执行删除。 */
  bundleDir: string;
}

/** PlanDeleteBundleInput 是生成删除计划的安全校验输入。 */
export interface PlanDeleteBundleInput {
  repoRoot: string;
  contentDir: string;
  bundleRelativeDir: string;
}

interface FrontmatterParts {
  frontmatter: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

/** normalizeSlash 统一路径分隔符，确保 Windows/Unix 输入都能稳定匹配。 */
function normalizeSlash(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

/** trimSlashes 去掉首尾斜杠，避免路径拼接时产生空段或绝对路径。 */
function trimSlashes(value: string): string {
  return normalizeSlash(value).replace(/^\/+|\/+$/g, "");
}

/** isPlainObject 判断 YAML 结果是否为普通对象，防止 null/数组污染 frontmatter 解析。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** parseFrontmatter 拆分 YAML frontmatter 与正文；正文中的 --- 不参与匹配。 */
function parseFrontmatter(content: string): FrontmatterParts {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: {}, body: content, hasFrontmatter: false };
  }

  // NOTE: 只查找第二个行首分隔符，避免正文里的普通分隔线误伤 frontmatter 边界。
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: {}, body: content, hasFrontmatter: false };
  }

  // NOTE: 博客管理列表需要保留 frontmatter 字面值，尤其是带时区的 date；
  //       FAILSAFE_SCHEMA 不会把 2026-04-27T10:11:26+08:00 自动转成 UTC Date。
  const parsed = yaml.load(match[1], { schema: yaml.FAILSAFE_SCHEMA });
  const frontmatter = isPlainObject(parsed) ? parsed : {};
  const body = content.slice(match[0].length);

  return { frontmatter, body, hasFrontmatter: true };
}

/** getStringField 读取字符串字段；Date 会转成 ISO 字符串以保持 API 类型稳定。 */
function getStringField(frontmatter: Record<string, unknown>, key: string): string | undefined {
  const value = frontmatter[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return undefined;
}

/** getArrayField 将 YAML 中的数组或逗号分隔字符串统一归一成字符串数组。 */
function getArrayField(frontmatter: Record<string, unknown>, key: string): string[] {
  const value = frontmatter[key];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

/** getDraftField 只把布尔 true 视为未发布；字符串 true 兼容轻量 frontmatter 写法。 */
function getDraftField(frontmatter: Record<string, unknown>): boolean {
  const value = frontmatter.draft;
  return value === true || value === "true";
}

/** getLeafBundleDir 从 leaf bundle 的 index.md 路径中取出 bundle 目录。 */
function getLeafBundleDir(indexPath: string): string {
  return indexPath.replace(/\/index\.md$/i, "");
}

/** getFallbackTitle 使用 bundle 末级目录名兜底，避免无标题文章在管理列表中空白。 */
function getFallbackTitle(bundleDir: string): string {
  const parts = bundleDir.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "index";
}

/**
 * scanBlogPosts 扫描 Hugo leaf bundle 列表并解析核心 frontmatter 字段。
 * 输入：仓库根、内容目录、抽象文件读取器。
 * 返回：按 index.md 路径排序后的 BlogPostEntry 数组。
 */
export async function scanBlogPosts(input: ScanBlogPostsInput): Promise<BlogPostEntry[]> {
  const contentDir = trimSlashes(input.contentDir);
  const files = await input.reader.listFiles();
  const indexPaths = files
    .map(normalizeSlash)
    .filter((file) => file.startsWith(`${contentDir}/`) && /(^|\/)index\.md$/i.test(file))
    .sort((a, b) => a.localeCompare(b));

  const posts: BlogPostEntry[] = [];
  for (const indexPath of indexPaths) {
    const content = await input.reader.readFile(indexPath);
    const { frontmatter } = parseFrontmatter(content);
    const bundleDir = getLeafBundleDir(indexPath);
    const draft = getDraftField(frontmatter);

    posts.push({
      title: getStringField(frontmatter, "title") ?? getFallbackTitle(bundleDir),
      date: getStringField(frontmatter, "date"),
      categories: getArrayField(frontmatter, "categories"),
      tags: getArrayField(frontmatter, "tags"),
      draft,
      slug: getStringField(frontmatter, "slug"),
      status: draft ? "unpublished" : "published",
      bundleDir,
      indexPath,
    });
  }

  return posts;
}

/**
 * setPostDraft 修改 index.md 的 draft 字段并保留正文。
 * 输入：完整 index.md 内容与目标 draft 状态。
 * 返回：更新后的完整 Markdown 文本；若原文无 frontmatter，则创建一个仅含 draft 的 YAML 块。
 */
export function setPostDraft(content: string, draft: boolean): string {
  const parts = parseFrontmatter(content);
  const nextFrontmatter = { ...parts.frontmatter, draft };
  const rendered = yaml.dump(nextFrontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });

  // NOTE: 正文原样拼回，不规范化换行，避免图片链接、手写分隔线等内容产生无关 diff。
  return `---\n${rendered}---\n${parts.hasFrontmatter ? parts.body : content}`;
}

/**
 * planDeleteBundle 生成 leaf bundle 删除计划并执行路径逃逸校验。
 * 输入：repoRoot/contentDir 和 contentDir 下的 bundle 相对目录。
 * 返回：相对 repoRoot 的安全 bundle 目录路径。
 * 异常：当 bundleRelativeDir 试图通过 ../ 或绝对路径逃逸内容目录时抛错。
 */
export function planDeleteBundle(input: PlanDeleteBundleInput): DeleteBundlePlan {
  const contentDir = trimSlashes(input.contentDir);
  const rawBundleDir = normalizeSlash(input.bundleRelativeDir);

  if (path.isAbsolute(input.bundleRelativeDir) || rawBundleDir.split("/").includes("..")) {
    throw new Error("删除计划路径逃逸：bundle 目录不能包含绝对路径或 ../");
  }

  const bundleDir = trimSlashes(`${contentDir}/${rawBundleDir}`);
  const normalized = path.posix.normalize(bundleDir);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("删除计划路径逃逸：bundle 目录必须位于 contentDir 内");
  }

  return { bundleDir: normalized };
}
