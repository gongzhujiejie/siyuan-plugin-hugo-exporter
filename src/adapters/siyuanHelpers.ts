/**
 * 文件用途：思源文档适配器的纯函数辅助方法。
 * 创建日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：项目内部类型。
 */
import type { SiYuanDocumentSnapshot } from "../core/types";

interface ApiLikeResponse {
  data: unknown;
}

interface SnapshotInput {
  docId: string;
  title: string;
  markdown: string;
  attrs: Record<string, string | undefined>;
  now: string;
}

/**
 * dateFromSiYuanId 将思源块 ID 前 14 位时间戳转成博客使用的 +08:00 时间。
 * 输入：形如 20260427101126-abcdefg 的思源块 ID。
 * 返回：形如 2026-04-27T10:11:26+08:00 的字符串。
 */
export function dateFromSiYuanId(id: string, fallback = new Date().toISOString()): string {
  const match = id.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-/);

  if (!match) {
    return fallback;
  }

  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}

/** extractMarkdownFromExportResponse 从思源导出响应中提取 Markdown。 */
export function extractMarkdownFromExportResponse(response: Pick<ApiLikeResponse, "data">): string {
  if (typeof response.data === "string") {
    return response.data;
  }

  if (response.data && typeof response.data === "object" && "content" in response.data) {
    const content = (response.data as { content?: unknown }).content;
    return typeof content === "string" ? content : "";
  }

  return "";
}

/** normalizeAttrs 只保留 string/undefined 属性，避免复杂对象进入 frontmatter。 */
export function normalizeAttrs(data: unknown): Record<string, string | undefined> {
  if (!data || typeof data !== "object") {
    return {};
  }

  const attrs = data as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(attrs).map(([key, value]) => [key, typeof value === "string" ? value : undefined]),
  );
}

/** titleFromDocInfo 从 getDocInfo 响应中解析文档名。 */
export function titleFromDocInfo(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "name" in data) {
    const name = (data as { name?: unknown }).name;
    if (typeof name === "string" && name.trim().length > 0) {
      return name.replace(/\.sy$/i, "");
    }
  }

  return fallback;
}

/** createSnapshotFromApiData 将思源 API 片段组合为导出核心需要的文档快照。 */
export function createSnapshotFromApiData(input: SnapshotInput): SiYuanDocumentSnapshot {
  return {
    id: input.docId,
    title: input.title,
    markdown: input.markdown,
    createdAt: dateFromSiYuanId(input.docId, input.now),
    updatedAt: input.now,
    attrs: input.attrs,
  };
}
