import { describe, expect, it } from "vitest";
import { buildFrontmatter, renderFrontmatterYaml } from "./frontmatter";
import { FIXIT_BLOG_PRESET } from "../presets/fixitBlog";
import type { SiYuanDocumentSnapshot } from "./types";

const doc: SiYuanDocumentSnapshot = {
  id: "20260525120000-abcdefg",
  title: "Acfun",
  markdown: "## 端口扫描\n正文",
  createdAt: "2026-04-27T10:11:26+08:00",
  updatedAt: "2026-04-28T20:15:59+08:00",
  attrs: {
    "custom-hugo-categories": "MAZESEC",
    "custom-hugo-tags": "靶机, Samba",
    "custom-hugo-description": "Acfun 靶机完整渗透流程",
    "custom-hugo-collections": "MAZESEC Writeups",
  },
};

describe("buildFrontmatter", () => {
  it("builds values from document metadata and SiYuan attrs", () => {
    const fm = buildFrontmatter(doc, FIXIT_BLOG_PRESET);

    expect(fm).toEqual({
      title: "Acfun",
      date: "2026-04-27T10:11:26+08:00",
      lastmod: "2026-04-28T20:15:59+08:00",
      categories: ["MAZESEC"],
      tags: ["靶机", "Samba"],
      description: "Acfun 靶机完整渗透流程",
      wordCount: true,
      math: true,
      draft: false,
      collections: ["MAZESEC Writeups"],
    });
  });
});

describe("renderFrontmatterYaml", () => {
  it("renders stable YAML delimiters", () => {
    const yaml = renderFrontmatterYaml(buildFrontmatter(doc, FIXIT_BLOG_PRESET));

    expect(yaml).toContain("---\n");
    expect(yaml).toContain("title: Acfun\n");
    expect(yaml).toContain("categories:\n  - MAZESEC\n");
    expect(yaml).toContain("tags:\n  - 靶机\n  - Samba\n");
    expect(yaml.endsWith("---\n")).toBe(true);
  });
});
