/**
 * 文件用途：解析 Markdown 中的本地资源链接，并生成 Hugo images 目录的复制与改写计划。
 * 创建日期：2026-05-25
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
