/**
 * 文件用途：导出对话框使用的纯函数辅助库。
 * 拆分原因：vitest 在解析 siyuan 包时报错；让纯函数与 DOM/Dialog 解耦后，
 *           测试只 import helpers，避免 vitest 触发 siyuan 包入口解析。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：项目内部 core/types、core/slug。
 */
import type { FrontmatterFieldConfig } from "../core/types";
import { slugifyTitle } from "../core/slug";

/** COMMON_FIELD_KEYS 控制默认展开的常用字段顺序。 */
export const COMMON_FIELD_KEYS = ["title", "categories", "tags", "description", "featuredImage", "draft"];

/**
 * parseArrayInput 把 textarea 或自由输入里的数组文本解析成稳定数组。
 * 支持换行、英文逗号、中文逗号，并去除空值与重复项。
 */
export function parseArrayInput(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value.split(/[\n,，]/).map((entry) => entry.trim())) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

/** stringifyArray 把数组字段渲染为 textarea 可读格式。 */
export function stringifyArray(value: unknown): string {
  return Array.isArray(value) ? value.map((item) => String(item)).join("\n") : "";
}

/** stringifyObject 把对象字段渲染为 JSON，便于在高级字段中编辑 toc 等配置。 */
export function stringifyObject(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

/** parseObjectInput 解析高级对象字段；空值代表不写入 frontmatter。 */
export function parseObjectInput(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`字段格式错误（需 JSON）：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** stringifyScalar 把普通标量字段安全转为字符串。 */
export function stringifyScalar(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : String(value);
}

/**
 * toggleArrayValue 切换多选 chip 的选中状态。
 * 返回新数组而不是原地修改，便于 UI 重新渲染时保持行为清晰。
 */
export function toggleArrayValue(values: string[], value: string): string[] {
  const normalized = value.trim();
  if (!normalized) return values;
  return values.includes(normalized) ? values.filter((item) => item !== normalized) : [...values, normalized];
}

/**
 * splitFrontmatterFields 按常用/高级分组，常用字段强制按 COMMON_FIELD_KEYS 排列。
 * 这样 title/categories/tags/description/draft 总在打开弹窗时优先可见。
 */
export function splitFrontmatterFields(fields: FrontmatterFieldConfig[]): {
  common: FrontmatterFieldConfig[];
  advanced: FrontmatterFieldConfig[];
} {
  const sorted = [...fields].sort((a, b) => a.order - b.order);
  const common = COMMON_FIELD_KEYS.map((key) => sorted.find((field) => field.key === key)).filter(
    (field): field is FrontmatterFieldConfig => Boolean(field),
  );
  const advanced = sorted.filter((field) => !COMMON_FIELD_KEYS.includes(field.key));
  return { common, advanced };
}

/** normalizePortablePath 将 Windows 与 POSIX 分隔符统一为正斜杠。 */
function normalizePortablePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/g, "");
}

/**
 * buildTargetPreview 生成对话框顶部展示的目标 index.md 路径。
 * 注意：这是预览字符串，真实写入路径仍由 core/slug.ts 中的 buildBundlePaths 生成和校验。
 */
export function buildTargetPreview(
  repoRoot: string,
  contentDir: string,
  slug: string,
  indexName = "index.md",
): string {
  return [normalizePortablePath(repoRoot), normalizePortablePath(contentDir), slugifyTitle(slug), indexName]
    .filter(Boolean)
    .join("/");
}

/** mergeOptionValues 合并设置候选项与当前已有值，确保旧文章字段也能显示为 chip。 */
export function mergeOptionValues(options: string[], current: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of [...options, ...current].map((entry) => entry.trim())) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

/**
 * resolveImagePreviewUrl 把 frontmatter / 正文里写的"图片地址"换算成浏览器能加载的预览 URL。
 *
 * 输入：
 *   - raw: 原始字符串。可能是远端 URL、思源 assets/xxx.png、file://、Windows 绝对路径，或 bundle 内 images/xxx。
 *   - assetBasePath: 可选；通常是思源 workspace 的 data 目录（绝对路径）。仅在魔尊填的是相对路径而我们想用 file:// 兜底时才用得到。
 *
 * 返回：
 *   - 浏览器能直接 set 到 <img src> 的字符串；无法预览时返回空串，让 UI 隐藏 thumbnail。
 *
 * 行为：
 *   - 远端协议（http/https/data:/blob:）→ 原样返回。
 *   - file:// → 原样返回。
 *   - Windows 绝对路径（如 D:/foo.png）→ 拼成 file:///D:/foo.png。
 *   - 思源 assets/... → 思源 kernel 把 /assets/<path> 直接映射到 workspace 的 data/assets，所以返回前缀斜杠版本即可。
 *   - 其它相对路径（如 bundle 内 images/foo.png）→ 浏览器无法访问 hugo 仓库，返回空串。
 */
export function resolveImagePreviewUrl(raw: string, assetBasePath?: string): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (/^file:/i.test(value)) return value;
  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    // Windows 绝对路径：归一化分隔符，并加 file:/// 让浏览器可加载（Electron 渲染层一般允许）。
    return `file:///${value.replaceAll("\\", "/").replace(/^\/+/, "")}`;
  }
  if (/^\//.test(value)) {
    // POSIX 绝对路径：在思源 webview 里通常解析为 kernel 同源路径，原样返回试试。
    return value;
  }
  if (/^assets[\\/]/i.test(value)) {
    // 思源 assets/foo.png：以 / 开头让浏览器按 kernel 同源根去取，思源 kernel 会服务到 workspace data/assets。
    return `/${value.replaceAll("\\", "/")}`;
  }
  // bundle 内相对路径（images/cover.png）等 → 没有 base 可拼；如果给了 assetBasePath 当作 file 兜底。
  if (assetBasePath && assetBasePath.trim()) {
    const base = assetBasePath.replaceAll("\\", "/").replace(/\/+$/g, "");
    return `file:///${base}/${value.replaceAll("\\", "/")}`;
  }
  return "";
}
