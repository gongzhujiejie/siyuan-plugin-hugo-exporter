/**
 * 文件用途：封装思源运行时读取当前文档的能力。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：siyuan、项目内部类型。
 *
 * NOTE: 思源 API 路由名称基于官方插件 SDK 与常用内核 API；若未来内核调整，集中修改本文件。
 */
import { fetchSyncPost, getActiveEditor } from "siyuan";
import type { SiYuanDocumentSnapshot } from "../core/types";
import {
  createSnapshotFromApiData,
  extractMarkdownFromExportResponse,
  normalizeAttrs,
  titleFromDocInfo,
} from "./siyuanHelpers";

/** SiYuanRuntimePort 描述 M1 需要的最小思源能力，方便测试和替换。 */
export interface SiYuanRuntimePort {
  getCurrentDocumentId(): Promise<string>;
  getDocumentTitle(docId: string): Promise<string>;
  exportMarkdown(docId: string): Promise<string>;
  getDocumentAttrs(docId: string): Promise<Record<string, string | undefined>>;
  getDocumentCreatedAt(docId: string): Promise<string>;
  getDocumentUpdatedAt(docId: string): Promise<string>;
}

interface ApiLikeResponse {
  code: number;
  data: unknown;
  msg?: string;
}

/** ensureSuccess 在思源 API 非 0 状态时抛出带上下文的错误。 */
function ensureSuccess(response: ApiLikeResponse, action: string): void {
  if (response.code !== 0) {
    throw new Error(`${action} failed: ${response.msg ?? "unknown SiYuan API error"}`);
  }
}

/**
 * NoActiveDocumentError 是"思源里没有打开任何文档"这一业务级错误的专属类。
 * runExport 捕获时会识别它并给出友好的中文提示，而不是走通用错误堆栈。
 */
export class NoActiveDocumentError extends Error {
  constructor(message = "未找到活动思源文档，请先在思源里打开一篇文档再点导出。") {
    super(message);
    this.name = "NoActiveDocumentError";
  }
}

/** getActiveDocumentId 从当前活动编辑器中取根文档 ID。 */
export function getActiveDocumentId(): string {
  const editor = getActiveEditor();
  const docId = editor?.protyle?.block?.rootID ?? editor?.protyle?.block?.id;

  if (!docId) {
    throw new NoActiveDocumentError();
  }

  return docId;
}

/** hasActiveDocument 仅检查是否能拿到活动文档 ID，不抛错。用于 runExport 前置校验。 */
export function hasActiveDocument(): boolean {
  try {
    const editor = getActiveEditor();
    const docId = editor?.protyle?.block?.rootID ?? editor?.protyle?.block?.id;
    return Boolean(docId);
  } catch {
    return false;
  }
}

/**
 * readCurrentDocumentSnapshot 从思源运行时读取导出所需的最小文档快照。
 * 输入：无，直接读取当前活动编辑器。
 * 返回：统一的文档快照。
 */
export async function readCurrentDocumentSnapshot(): Promise<SiYuanDocumentSnapshot> {
  const docId = getActiveDocumentId();
  const now = new Date().toISOString();

  const [markdownResponse, attrsResponse, infoResponse] = await Promise.all([
    fetchSyncPost("/api/export/exportMdContent", { id: docId }) as Promise<ApiLikeResponse>,
    fetchSyncPost("/api/attr/getBlockAttrs", { id: docId }) as Promise<ApiLikeResponse>,
    fetchSyncPost("/api/block/getDocInfo", { id: docId }) as Promise<ApiLikeResponse>,
  ]);

  ensureSuccess(markdownResponse, "Export markdown");
  ensureSuccess(attrsResponse, "Read document attributes");
  ensureSuccess(infoResponse, "Read document info");

  return createSnapshotFromApiData({
    docId,
    title: titleFromDocInfo(infoResponse.data, docId),
    markdown: extractMarkdownFromExportResponse(markdownResponse),
    attrs: normalizeAttrs(attrsResponse.data),
    now,
  });
}
