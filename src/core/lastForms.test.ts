import { describe, expect, it } from "vitest";
import {
  estimateLastFormsBytes,
  migrateLastFormsRecord,
  normalizeLastForms,
  pruneLastForms,
} from "./lastForms";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("migrateLastFormsRecord", () => {
  const fallback = "2026-05-26T00:00:00.000Z";

  it("keeps new-format records as is", () => {
    const result = migrateLastFormsRecord(
      { fields: { categories: ["A"] }, lastAccessedAt: "2026-05-25T00:00:00.000Z" },
      fallback,
    );
    expect(result).toEqual({
      fields: { categories: ["A"] },
      lastAccessedAt: "2026-05-25T00:00:00.000Z",
    });
  });

  it("upgrades legacy bare fields object", () => {
    const result = migrateLastFormsRecord({ categories: ["A"], tags: ["B"] }, fallback);
    expect(result).toEqual({
      fields: { categories: ["A"], tags: ["B"] },
      lastAccessedAt: fallback,
    });
  });

  it("rejects null / array / non-object", () => {
    expect(migrateLastFormsRecord(null, fallback)).toBeNull();
    expect(migrateLastFormsRecord([1, 2, 3], fallback)).toBeNull();
    expect(migrateLastFormsRecord("hello", fallback)).toBeNull();
  });
});

describe("normalizeLastForms", () => {
  const fallback = "2026-05-26T00:00:00.000Z";

  it("filters invalid entries silently", () => {
    const result = normalizeLastForms(
      {
        valid1: { fields: { tags: ["A"] }, lastAccessedAt: "2026-05-25T00:00:00.000Z" },
        valid2: { categories: ["B"] }, // legacy
        bad1: null,
        bad2: [],
        bad3: 123,
      },
      fallback,
    );

    expect(Object.keys(result).sort()).toEqual(["valid1", "valid2"]);
    expect(result.valid2).toEqual({ fields: { categories: ["B"] }, lastAccessedAt: fallback });
  });

  it("returns empty map for non-object raw", () => {
    expect(normalizeLastForms(null)).toEqual({});
    expect(normalizeLastForms("plain string")).toEqual({});
    expect(normalizeLastForms([1, 2, 3])).toEqual({});
  });
});

describe("pruneLastForms", () => {
  const now = new Date("2026-05-26T00:00:00.000Z").getTime();
  const day = (offsetDays: number) => new Date(now - offsetDays * MS_PER_DAY).toISOString();

  it("removes records older than ttl days", () => {
    const result = pruneLastForms(
      {
        fresh: { fields: { tags: ["A"] }, lastAccessedAt: day(2) },
        oldButOk: { fields: { tags: ["B"] }, lastAccessedAt: day(89.9) },
        rotten: { fields: { tags: ["C"] }, lastAccessedAt: day(91) },
      },
      { ttlDays: 90, now },
    );

    expect(Object.keys(result.pruned).sort()).toEqual(["fresh", "oldButOk"]);
    expect(result.removed.byTtl).toEqual(["rotten"]);
    expect(result.totalBefore).toBe(3);
    expect(result.totalAfter).toBe(2);
  });

  it("removes oldest entries when over maxEntries", () => {
    const input: Record<string, { fields: Record<string, unknown>; lastAccessedAt: string }> = {};
    for (let i = 0; i < 10; i += 1) {
      input[`doc-${i}`] = { fields: { tags: [`tag-${i}`] }, lastAccessedAt: day(i) };
    }
    // doc-0 最新，doc-9 最旧

    const result = pruneLastForms(input, { maxEntries: 5, now });
    expect(Object.keys(result.pruned).sort()).toEqual(["doc-0", "doc-1", "doc-2", "doc-3", "doc-4"]);
    expect(result.removed.byLimit.sort()).toEqual(["doc-5", "doc-6", "doc-7", "doc-8", "doc-9"]);
  });

  it("removes records whose docId is not in validIds", () => {
    const result = pruneLastForms(
      {
        alive: { fields: { tags: ["A"] }, lastAccessedAt: day(1) },
        dead: { fields: { tags: ["B"] }, lastAccessedAt: day(1) },
      },
      { validIds: new Set(["alive"]), now },
    );

    expect(Object.keys(result.pruned)).toEqual(["alive"]);
    expect(result.removed.byMissingDoc).toEqual(["dead"]);
  });

  it("ttl 与 maxEntries 组合：先按 ttl 删过期，再按 LRU 限容", () => {
    const result = pruneLastForms(
      {
        veryOld: { fields: {}, lastAccessedAt: day(100) },
        old: { fields: {}, lastAccessedAt: day(80) },
        mid: { fields: {}, lastAccessedAt: day(40) },
        recent: { fields: {}, lastAccessedAt: day(2) },
      },
      { ttlDays: 90, maxEntries: 2, now },
    );

    // veryOld 被 ttl 删；剩下 3 条按 maxEntries=2 删最旧的 old
    expect(Object.keys(result.pruned).sort()).toEqual(["mid", "recent"]);
    expect(result.removed.byTtl).toEqual(["veryOld"]);
    expect(result.removed.byLimit).toEqual(["old"]);
  });

  it("无任何选项时不做任何淘汰", () => {
    const input = {
      a: { fields: { tags: ["A"] }, lastAccessedAt: day(1000) },
      b: { fields: { tags: ["B"] }, lastAccessedAt: day(1000) },
    };
    const result = pruneLastForms(input, {});
    expect(result.pruned).toEqual(input);
    expect(result.removed.byTtl).toEqual([]);
    expect(result.removed.byLimit).toEqual([]);
    expect(result.removed.byMissingDoc).toEqual([]);
  });
});

describe("estimateLastFormsBytes", () => {
  it("returns a positive number for a non-empty map", () => {
    const size = estimateLastFormsBytes({
      doc1: { fields: { tags: ["A", "B"], description: "hello" }, lastAccessedAt: "2026-05-25T00:00:00.000Z" },
    });
    expect(size).toBeGreaterThan(0);
  });

  it("returns small bytes for empty map", () => {
    expect(estimateLastFormsBytes({})).toBeLessThan(10);
  });
});
