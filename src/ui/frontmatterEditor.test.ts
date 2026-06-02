import { describe, expect, it } from "vitest";
import {
  buildTargetPreview,
  mergeOptionValues,
  parseArrayInput,
  resolveImagePreviewUrl,
  splitFrontmatterFields,
  toggleArrayValue,
} from "./frontmatterEditor.helpers";
import { FIXIT_BLOG_PRESET } from "../presets/fixitBlog";

describe("frontmatter editor helpers", () => {
  it("parses newline and comma separated array values", () => {
    expect(parseArrayInput("MAZESEC\n靶机, Samba，Linux\n")).toEqual(["MAZESEC", "靶机", "Samba", "Linux"]);
  });

  it("toggles array selector values without duplicates", () => {
    expect(toggleArrayValue(["MAZESEC"], "渗透测试")).toEqual(["MAZESEC", "渗透测试"]);
    expect(toggleArrayValue(["MAZESEC", "渗透测试"], "MAZESEC")).toEqual(["渗透测试"]);
  });

  it("splits common and advanced fields", () => {
    const split = splitFrontmatterFields(FIXIT_BLOG_PRESET.frontmatterFields);
    expect(split.common.map((field) => field.key)).toEqual([
      "title",
      "categories",
      "tags",
      "description",
      "featuredImage",
      "draft",
    ]);
    expect(split.advanced.map((field) => field.key)).toContain("collections");
    expect(split.advanced.map((field) => field.key)).toContain("summary");
    expect(split.advanced.map((field) => field.key)).toContain("featuredImagePreview");
  });

  it("builds target preview with normalized slashes", () => {
    expect(buildTargetPreview("I:/my-blog", "content/posts", "maze", "index.md")).toBe(
      "I:/my-blog/content/posts/maze/index.md",
    );
  });

  it("merges configured options with current values without duplicates", () => {
    expect(mergeOptionValues(["MAZESEC", "渗透测试"], ["渗透测试", "HackMyVM"])).toEqual([
      "MAZESEC",
      "渗透测试",
      "HackMyVM",
    ]);
  });

  describe("resolveImagePreviewUrl", () => {
    it("returns empty for empty input", () => {
      expect(resolveImagePreviewUrl("")).toBe("");
      expect(resolveImagePreviewUrl("   ")).toBe("");
    });

    it("keeps remote and data URLs as-is", () => {
      expect(resolveImagePreviewUrl("https://x/y.png")).toBe("https://x/y.png");
      expect(resolveImagePreviewUrl("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
      expect(resolveImagePreviewUrl("blob:http://x/abc")).toBe("blob:http://x/abc");
    });

    it("keeps file:// URLs as-is", () => {
      expect(resolveImagePreviewUrl("file:///D:/foo/bar.png")).toBe("file:///D:/foo/bar.png");
    });

    it("converts Windows absolute path to file URL", () => {
      expect(resolveImagePreviewUrl("D:\\foo\\bar.png")).toBe("file:///D:/foo/bar.png");
      expect(resolveImagePreviewUrl("D:/foo/bar.png")).toBe("file:///D:/foo/bar.png");
    });

    it("prefixes siyuan assets/ with leading slash for kernel base", () => {
      expect(resolveImagePreviewUrl("assets/cover.png")).toBe("/assets/cover.png");
      expect(resolveImagePreviewUrl("assets\\cover.png")).toBe("/assets/cover.png");
    });

    it("uses assetBasePath as file:// fallback for bundle-relative paths", () => {
      expect(resolveImagePreviewUrl("images/cover.png", "E:/data")).toBe(
        "file:///E:/data/images/cover.png",
      );
    });

    it("returns empty when no base provided for bundle-relative", () => {
      expect(resolveImagePreviewUrl("images/cover.png")).toBe("");
    });
  });
});
