/**
 * 文件用途：缓存"上次填过的表单字段值"的存储格式与淘汰逻辑。
 * 创建日期：2026-05-26
 * 修改日期：2026-05-26
 * 语言版本：TypeScript 5.x
 * 依赖库：无运行时依赖。
 *
 * 设计：
 * - 旧版 v0.2.3 直接把 frontmatter 字段对象按 docId 存进 lastForms；
 * - v0.2.4 升级为 {fields, lastAccessedAt} 结构以支持 LRU 淘汰；
 * - migrateLastFormsRecord 兼容旧格式，让升级用户不丢数据。
 *
 * 三层淘汰策略：
 * 1. 时间淘汰 — 超过 LASTFORM_TTL_DAYS 天未访问 → 清理；
 * 2. 容量淘汰 — 超过 LASTFORM_LIMIT 条 → 按 lastAccessedAt 删最旧；
 * 3. 死链淘汰 — onload 后后台异步校验 docId 存在性，死链则清理（runtime 实现）。
 */

/** LastFormRecord 是单条文档缓存的最新结构。 */
export interface LastFormRecord {
  /** fields 是上次导出本文档时填的非 title/date/lastmod 字段值。 */
  fields: Record<string, unknown>;
  /** lastAccessedAt 是 ISO 时间字符串，记录最后一次写入/读取，用于 LRU。 */
  lastAccessedAt: string;
}

/** LastFormsMap 是按 docId 索引的缓存表（外部 storage 直接序列化它）。 */
export type LastFormsMap = Record<string, LastFormRecord>;

/** PruneOptions 控制淘汰策略；不传任一项就只跑剩下那一种。 */
export interface PruneOptions {
  /** maxEntries 容量上限；超过则按 lastAccessedAt 删最旧。0 或未传 = 不限。 */
  maxEntries?: number;
  /** ttlDays 时间上限（天）；超过则清理。0 或未传 = 不限。 */
  ttlDays?: number;
  /** now 当前时间，便于测试注入；默认取 Date.now()。 */
  now?: number;
  /** validIds 思源里仍存在的 docId 集合；传入则启用死链淘汰。 */
  validIds?: ReadonlySet<string>;
}

/** PruneResult 汇总本次淘汰的结果，便于 UI / log 展示。 */
export interface PruneResult {
  pruned: LastFormsMap;
  removed: {
    byTtl: string[];
    byLimit: string[];
    byMissingDoc: string[];
  };
  totalBefore: number;
  totalAfter: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * migrateLastFormsRecord 把旧格式（裸字段对象）升级为 {fields, lastAccessedAt} 结构。
 * 输入：未知形态的对象（可能是新格式、旧格式、或损坏数据）。
 * 返回：合法的 LastFormRecord；遇到完全不可识别的对象时返回 null。
 */
export function migrateLastFormsRecord(input: unknown, fallbackTime: string): LastFormRecord | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;

  // 新格式：已经有 fields + lastAccessedAt
  if (
    typeof obj.fields === "object" &&
    obj.fields !== null &&
    !Array.isArray(obj.fields) &&
    typeof obj.lastAccessedAt === "string"
  ) {
    return {
      fields: obj.fields as Record<string, unknown>,
      lastAccessedAt: obj.lastAccessedAt,
    };
  }

  // 旧格式：整个对象就是 fields
  return {
    fields: obj as Record<string, unknown>,
    lastAccessedAt: fallbackTime,
  };
}

/**
 * normalizeLastForms 把任意 storage 读到的对象规范化为 LastFormsMap。
 * 输入：未知 raw（最常见是 Record<string, anything>）。
 * 返回：合法的 LastFormsMap；任何无效条目静默丢弃。
 */
export function normalizeLastForms(raw: unknown, fallbackTime = new Date().toISOString()): LastFormsMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: LastFormsMap = {};
  for (const [docId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!docId || typeof docId !== "string") continue;
    const record = migrateLastFormsRecord(value, fallbackTime);
    if (record) result[docId] = record;
  }
  return result;
}

/**
 * pruneLastForms 按 TTL / LRU / 死链淘汰陈旧记录，返回新 map 与本次移除清单。
 * 输入：现有 LastFormsMap、淘汰选项。
 * 返回：纯函数；不修改入参。
 */
export function pruneLastForms(input: LastFormsMap, options: PruneOptions = {}): PruneResult {
  const now = options.now ?? Date.now();
  const totalBefore = Object.keys(input).length;
  const removed: PruneResult["removed"] = { byTtl: [], byLimit: [], byMissingDoc: [] };
  const surviving: LastFormsMap = {};

  for (const [docId, record] of Object.entries(input)) {
    // 死链淘汰
    if (options.validIds && !options.validIds.has(docId)) {
      removed.byMissingDoc.push(docId);
      continue;
    }
    // 时间淘汰
    if (options.ttlDays && options.ttlDays > 0) {
      const accessedTs = Date.parse(record.lastAccessedAt);
      if (!Number.isNaN(accessedTs) && now - accessedTs > options.ttlDays * MS_PER_DAY) {
        removed.byTtl.push(docId);
        continue;
      }
    }
    surviving[docId] = record;
  }

  // LRU 容量淘汰：留下来的若超过 maxEntries，按 lastAccessedAt 升序删最旧。
  if (options.maxEntries && options.maxEntries > 0) {
    const entries = Object.entries(surviving);
    if (entries.length > options.maxEntries) {
      entries.sort(([, a], [, b]) => Date.parse(a.lastAccessedAt) - Date.parse(b.lastAccessedAt));
      const overflow = entries.length - options.maxEntries;
      for (let i = 0; i < overflow; i += 1) {
        const [docId] = entries[i];
        removed.byLimit.push(docId);
        delete surviving[docId];
      }
    }
  }

  return {
    pruned: surviving,
    removed,
    totalBefore,
    totalAfter: Object.keys(surviving).length,
  };
}

/** estimateLastFormsBytes 估算 lastForms 序列化后的字节数，用于在 UI 展示。 */
export function estimateLastFormsBytes(map: LastFormsMap): number {
  try {
    return new Blob([JSON.stringify(map)]).size;
  } catch {
    // NOTE: 兜底——某些 jsdom/思源运行时 Blob 不可用，按 UTF-8 大致字符数估。
    return JSON.stringify(map).length;
  }
}
