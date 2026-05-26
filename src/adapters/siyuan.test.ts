import { describe, expect, it } from "vitest";
import { createSnapshotFromApiData, dateFromSiYuanId, extractMarkdownFromExportResponse } from "./siyuanHelpers";

describe("dateFromSiYuanId", () => {
  it("converts a SiYuan block id timestamp to +08:00 ISO string", () => {
    expect(dateFromSiYuanId("20260427101126-abcdefg")).toBe("2026-04-27T10:11:26+08:00");
  });

  it("falls back to the provided time for invalid ids", () => {
    expect(dateFromSiYuanId("bad-id", "2026-05-25T12:00:00+08:00")).toBe("2026-05-25T12:00:00+08:00");
  });
});

describe("extractMarkdownFromExportResponse", () => {
  it("reads markdown from data.content", () => {
    expect(extractMarkdownFromExportResponse({ data: { content: "# Hello" } })).toBe("# Hello");
  });

  it("reads markdown from string data", () => {
    expect(extractMarkdownFromExportResponse({ data: "# Hello" })).toBe("# Hello");
  });
});

describe("createSnapshotFromApiData", () => {
  it("builds a document snapshot from API response fragments", () => {
    expect(
      createSnapshotFromApiData({
        docId: "20260427101126-abcdefg",
        title: "Acfun",
        markdown: "## Body",
        attrs: { "custom-hugo-tags": "靶机" },
        now: "2026-05-25T12:00:00+08:00",
      }),
    ).toEqual({
      id: "20260427101126-abcdefg",
      title: "Acfun",
      markdown: "## Body",
      createdAt: "2026-04-27T10:11:26+08:00",
      updatedAt: "2026-05-25T12:00:00+08:00",
      attrs: { "custom-hugo-tags": "靶机" },
    });
  });
});
