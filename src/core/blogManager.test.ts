import { describe, expect, it } from "vitest";
import {
  planDeleteBundle,
  scanBlogPosts,
  setPostDraft,
  type BlogFileReader,
} from "./blogManager";

const reader = (files: Record<string, string>): BlogFileReader => ({
  listFiles: () => Object.keys(files),
  readFile: (relativePath: string) => files[relativePath] ?? "",
});

describe("scanBlogPosts", () => {
  it("扫描 draft=false 的 Hugo leaf bundle 为 published", async () => {
    const posts = await scanBlogPosts({
      repoRoot: "I:/blog",
      contentDir: "content/posts",
      reader: reader({
        "content/posts/acfun/index.md": "---\ntitle: Acfun\ndate: 2026-04-27T10:11:26+08:00\ncategories:\n  - MAZESEC\ntags:\n  - Samba\ndraft: false\nslug: acfun-writeup\n---\n正文",
      }),
    });

    expect(posts).toEqual([
      {
        title: "Acfun",
        date: "2026-04-27T10:11:26+08:00",
        categories: ["MAZESEC"],
        tags: ["Samba"],
        draft: false,
        slug: "acfun-writeup",
        status: "published",
        bundleDir: "content/posts/acfun",
        indexPath: "content/posts/acfun/index.md",
      },
    ]);
  });

  it("扫描 draft=true 的 Hugo leaf bundle 为 unpublished", async () => {
    const posts = await scanBlogPosts({
      repoRoot: "I:/blog",
      contentDir: "content/posts",
      reader: reader({
        "content/posts/draft-post/index.md": "---\ntitle: 草稿\ndraft: true\n---\n正文",
      }),
    });

    expect(posts[0]).toMatchObject({
      title: "草稿",
      draft: true,
      status: "unpublished",
      bundleDir: "content/posts/draft-post",
    });
  });

  it("缺少 title 时使用 bundle 目录名兜底", async () => {
    const posts = await scanBlogPosts({
      repoRoot: "I:/blog",
      contentDir: "content/posts",
      reader: reader({
        "content/posts/no-title/index.md": "---\ntags: [fallback]\n---\n正文",
      }),
    });

    expect(posts[0].title).toBe("no-title");
  });
});

describe("setPostDraft", () => {
  it("下架时为无 draft 的 frontmatter 新增 draft=true", () => {
    const updated = setPostDraft("---\ntitle: Acfun\n---\n正文", true);

    expect(updated).toContain("draft: true\n");
    expect(updated).toContain("title: Acfun\n");
  });

  it("恢复时把已有 draft 改为 false", () => {
    const updated = setPostDraft("---\ntitle: Acfun\ndraft: true\n---\n正文", false);

    expect(updated).toContain("draft: false\n");
    expect(updated).not.toContain("draft: true\n");
  });

  it("修改 draft 时保留正文不变", () => {
    const body = "# 正文\n\n![图](images/a.png)\n---\n正文里的分隔线";
    const updated = setPostDraft(`---\ntitle: Acfun\ndraft: false\n---\n${body}`, true);

    expect(updated.endsWith(body)).toBe(true);
  });
});

describe("planDeleteBundle", () => {
  it("生成删除计划时拒绝 ../ 路径逃逸", () => {
    expect(() =>
      planDeleteBundle({
        repoRoot: "I:/blog",
        contentDir: "content/posts",
        bundleRelativeDir: "../secrets",
      }),
    ).toThrow(/路径逃逸/);
  });
});
