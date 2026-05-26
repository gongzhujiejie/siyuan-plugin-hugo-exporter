import { describe, expect, it } from "vitest";
import {
  buildTargetPreview,
  mergeOptionValues,
  parseArrayInput,
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
    expect(split.common.map((field) => field.key)).toEqual(["title", "categories", "tags", "description", "draft"]);
    expect(split.advanced.map((field) => field.key)).toContain("collections");
    expect(split.advanced.map((field) => field.key)).toContain("summary");
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
});
