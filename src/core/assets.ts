/**
 * 文件用途：解析 Markdown 中的本地资源链接，并生成 Hugo images 目录的复制与改写计划。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-31
 * 语言版本：TypeScript 5.x
 * 依赖库：无运行时依赖。
 */
import type { AssetCopyPlan } from "./types";

interface PlanMarkdownAssetsInput {
  markdown: string;
  assetBasePath: string;
  relativeAssetDir: string;
  publicAssetDir: string;
  existingTargetNames: Set<string>;
}

interface PlanMarkdownAssetsResult {
  markdown: string;
  assetPlans: AssetCopyPlan[];
  warnings: string[];
}

const MARKDOWN_LINK_PATTERN = /(!?\[[^\]]*\]\()([^\s)]+)(\))/g;
const REMOTE_PROTOCOL_PATTERN = /^(https?:|mailto:|tel:|data:|#)/i;
// NOTE: WIN_ABS_PATH 用来识别 frontmatter 字段里魔尊填的 Windows 绝对路径，
//       例如 "D:/foo/cover.png" 或 "D:\\foo\\cover.png"。
//       Linux 下的 "/usr/foo.png" 也算绝对路径，但更可能是 hugo static 目录约定，因此不当成本地拷贝源。
const WIN_ABS_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;
// NOTE: BUNDLE_INTERNAL_PATH 用来识别已经写在 bundle 里的相对路径（如 "images/cover.png"），
//       这种情况下不需要再产生 AssetCopyPlan，避免和正文图片重复处理。
const BUNDLE_INTERNAL_PATH_PATTERN = /^(\.\.?\/|\/|[a-zA-Z]:)/;

/** normalizePortablePath 将 Windows 与 URL 路径统一为正斜杠路径。 */
function normalizePortablePath(pathValue: string): string {
  return pathValue.replaceAll("\\", "/");
}

/** joinPortable 使用正斜杠拼接路径，保证 manifest 跨平台稳定。 */
function joinPortable(...parts: string[]): string {
  return parts
    .map((part) => normalizePortablePath(part).replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

/** basenamePortable 从 URL 或 Windows 路径中获取文件名。 */
function basenamePortable(pathValue: string): string {
  const clean = normalizePortablePath(decodeURIComponent(pathValue)).split(/[?#]/)[0] ?? "asset";
  const parts = clean.split("/").filter(Boolean);
  return parts.at(-1) ?? "asset";
}

/**
 * sanitizeAssetFileName 清理资源文件名，防止路径穿越和非法字符进入目标目录。
 * 输入可能是完整 URL/path，因此先取 basename，再对文件名本体做安全化。
 */
export function sanitizeAssetFileName(fileName: string): string {
  const baseName = basenamePortable(fileName)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return baseName.length > 0 ? baseName : "asset";
}

/** isLocalAssetUrl 判断 Markdown 链接是否需要被复制到 Hugo bundle。 */
function isLocalAssetUrl(url: string): boolean {
  return !REMOTE_PROTOCOL_PATTERN.test(url);
}

/** toSourcePath 将 Markdown URL 转成源文件路径。 */
function toSourcePath(url: string, assetBasePath: string): string {
  if (url.toLowerCase().startsWith("file://")) {
    return normalizePortablePath(decodeURIComponent(url.replace(/^file:\/\/\/?/i, "")));
  }

  return joinPortable(assetBasePath, decodeURIComponent(url));
}

/** makeUniqueName 在同一 images 目录中生成不冲突文件名。 */
function makeUniqueName(fileName: string, usedNames: Set<string>): string {
  if (!usedNames.has(fileName)) {
    usedNames.add(fileName);
    return fileName;
  }

  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex > 0 ? fileName.slice(dotIndex) : "";
  let counter = 1;

  while (usedNames.has(`${stem}-${counter}${ext}`)) {
    counter += 1;
  }

  const unique = `${stem}-${counter}${ext}`;
  usedNames.add(unique);
  return unique;
}

/** planMarkdownAssets 解析 Markdown 链接，生成 rewritten Markdown 与资源复制计划。 */
export function planMarkdownAssets(input: PlanMarkdownAssetsInput): PlanMarkdownAssetsResult {
  const assetPlans: AssetCopyPlan[] = [];
  const warnings: string[] = [];
  const usedNames = new Set(input.existingTargetNames);

  const markdown = input.markdown.replace(MARKDOWN_LINK_PATTERN, (full, prefix: string, url: string, suffix: string) => {
    if (!isLocalAssetUrl(url)) {
      return full;
    }

    const safeName = makeUniqueName(sanitizeAssetFileName(url), usedNames);
    const sourcePath = toSourcePath(url, input.assetBasePath);
    const rewrittenUrl = joinPortable(input.publicAssetDir, safeName);
    const targetRelativePath = joinPortable(input.relativeAssetDir, safeName);

    assetPlans.push({
      originalUrl: url,
      sourcePath,
      targetRelativePath,
      rewrittenUrl,
    });

    return `${prefix}${rewrittenUrl}${suffix}`;
  });

  return {
    markdown,
    assetPlans,
    warnings,
  };
}

/** PlanFrontmatterImageInput 描述 frontmatter 字段（如 featuredImage）的资源处理输入。 */
export interface PlanFrontmatterImageInput {
  /** rawValue 是用户在弹窗或 YAML 里填的原始值（可能是 URL、相对路径、绝对路径或思源 assets/）。 */
  rawValue: string;
  /** assetBasePath 用于把思源相对资源路径（如 assets/foo.png）解析为磁盘路径。 */
  assetBasePath: string;
  /** relativeAssetDir 是当前 bundle 的相对资源目录，例如 content/posts/<slug>/images。 */
  relativeAssetDir: string;
  /** publicAssetDir 是 frontmatter 里写出去的相对前缀，通常是 "images"。 */
  publicAssetDir: string;
  /** existingTargetNames 是当前 bundle 已使用的文件名集合，避免与正文图片冲突。 */
  existingTargetNames: Set<string>;
}

/** PlanFrontmatterImageResult 描述 featuredImage 等字段处理后的产物。 */
export interface PlanFrontmatterImageResult {
  /** rewrittenValue 写回 frontmatter 的最终值；可能等于 rawValue（远端 URL / 已在 bundle 内）。 */
  rewrittenValue: string;
  /** assetPlan 仅当需要拷贝本地文件时存在；否则 undefined。 */
  assetPlan?: AssetCopyPlan;
  /** warnings 用于在 manifest 中提示用户：例如 "已识别为远端 URL，未拷贝"。 */
  warnings: string[];
}

/**
 * planFrontmatterImageAsset 处理 frontmatter 里的"指向图片"的字段（如 featuredImage / featuredImagePreview）。
 *
 * 行为分支（按优先级判定）：
 * 1. 空字符串 → 直接返回空，不产生 plan，不写 frontmatter。
 * 2. 远端 URL（http/https/data:/mailto: 等）→ 原样写入 frontmatter，不拷贝。
 * 3. 已经是 bundle 内的相对路径（如 "images/cover.png"）→ 原样写入，不重复拷贝（旧文章兼容）。
 * 4. file:// 协议 → 取 basename，按本地文件拷贝。
 * 5. Windows 绝对路径（如 D:/foo/cover.png）→ 直接当源路径拷贝。
 * 6. 思源相对资源（如 assets/foo.png）→ 用 assetBasePath 拼接，拷贝。
 *
 * 返回值里的 rewrittenValue 永远是写到 index.md frontmatter 的最终字符串，
 * 调用方应该用它替换 frontmatter[key]。
 */
export function planFrontmatterImageAsset(input: PlanFrontmatterImageInput): PlanFrontmatterImageResult {
  const warnings: string[] = [];
  const raw = (input.rawValue ?? "").trim();
  if (!raw) {
    return { rewrittenValue: "", warnings };
  }

  // 远端 URL：保留原样，让 Hugo 直接当外链处理。
  if (REMOTE_PROTOCOL_PATTERN.test(raw)) {
    return { rewrittenValue: raw, warnings };
  }

  // 思源相对资源（如 assets/foo.png）：拼接 assetBasePath 后拷贝。
  // 注意：必须放在"已在 bundle 内"判断之前，否则会被当作 bundle 内相对路径而不拷贝。
  const isSiyuanAsset = /^assets[\\/]/i.test(raw);

  // 已在 bundle 内（不带任何前缀的相对路径，如 images/cover.png 或 cover.png）→ 原样。
  // 例如旧文章 frontmatter 里的 "images/cover.png" 不应再次拷贝。
  if (
    !isSiyuanAsset &&
    !BUNDLE_INTERNAL_PATH_PATTERN.test(raw) &&
    !raw.toLowerCase().startsWith("file:")
  ) {
    return { rewrittenValue: normalizePortablePath(raw), warnings };
  }

  // file:// 协议：把 URL 解码后取磁盘路径。
  let sourcePath: string;
  if (raw.toLowerCase().startsWith("file:")) {
    sourcePath = normalizePortablePath(decodeURIComponent(raw.replace(/^file:\/\/\/?/i, "")));
  } else if (WIN_ABS_PATH_PATTERN.test(raw)) {
    // Windows 绝对路径：直接归一化分隔符即可。
    sourcePath = normalizePortablePath(raw);
  } else if (raw.startsWith("/")) {
    // POSIX 绝对路径：FixIt 推荐写到 static/ 下并用 /xxx.png；这里不拷贝，原样保留，
    // 让 Hugo 走 static 资源约定。
    return { rewrittenValue: raw, warnings: ["以 / 开头视作 Hugo static 路径，未拷贝"] };
  } else if (isSiyuanAsset) {
    // 思源 assets/foo.png → 用 assetBasePath 拼接得到磁盘路径。
    sourcePath = joinPortable(input.assetBasePath, decodeURIComponent(raw));
  } else {
    // 兜底（应该不会到这里，因为前面已经把所有"不带前缀的相对路径"返回了）。
    sourcePath = joinPortable(input.assetBasePath, decodeURIComponent(raw));
  }

  const safeName = makeUniqueName(sanitizeAssetFileName(raw), new Set(input.existingTargetNames));
  const rewrittenValue = joinPortable(input.publicAssetDir, safeName);
  const targetRelativePath = joinPortable(input.relativeAssetDir, safeName);

  return {
    rewrittenValue,
    assetPlan: {
      originalUrl: raw,
      sourcePath,
      targetRelativePath,
      rewrittenUrl: rewrittenValue,
    },
    warnings,
  };
}
