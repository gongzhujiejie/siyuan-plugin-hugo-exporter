import { describe, expect, it } from "vitest";
import { FIXIT_BLOG_PRESET } from "./fixitBlog";

describe("FIXIT_BLOG_PRESET", () => {
  it("matches the current Hugo leaf bundle structure", () => {
    expect(FIXIT_BLOG_PRESET.id).toBe("fixit-blog-current");
    expect(FIXIT_BLOG_PRESET.contentDir).toBe("content");
    expect(FIXIT_BLOG_PRESET.postsDir).toBe("posts");
    expect(FIXIT_BLOG_PRESET.assetDirName).toBe("images");
    expect(FIXIT_BLOG_PRESET.bundleIndexName).toBe("index.md");
  });

  it("contains frontmatter fields used by the current blog", () => {
    const keys = FIXIT_BLOG_PRESET.frontmatterFields.map((field) => field.key);

    expect(keys).toEqual([
      "title",
      "date",
      "lastmod",
      "categories",
      "tags",
      "description",
      "wordCount",
      "math",
      "draft",
      "collections",
      "toc",
      "comment",
      "password",
      "summary",
      "typeit",
    ]);
  });
});
