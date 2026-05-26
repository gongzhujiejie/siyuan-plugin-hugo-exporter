import { describe, expect, it } from "vitest";
import { exportHugoPost } from "./exportPipeline";
import { acfunDoc, acfunDocWithAssets } from "../test/fixtures";

describe("exportHugoPost", () => {
  it("creates a dry-run result with Hugo index.md content", () => {
    const result = exportHugoPost({
      doc: acfunDoc,
      repoRoot: "I:/my-blog",
      dryRun: true,
      now: "2026-05-25T12:00:00+08:00",
    });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.manifest.target).toBe("content/posts/acfun/index.md");
    expect(result.manifest.plannedWrites).toEqual(["content/posts/acfun/index.md"]);
    expect(result.content).toContain("---\n");
    expect(result.content).toContain("title: Acfun\n");
    expect(result.content).toContain("collections:\n  - MAZESEC Writeups\n");
    expect(result.content).toContain("## 端口扫描\n");
    expect(result.assetPlans).toEqual([]);
  });

  it("uses an explicit slug when provided", () => {
    const result = exportHugoPost({
      doc: acfunDoc,
      repoRoot: "I:/my-blog",
      slug: "maze-acfun",
      dryRun: true,
      now: "2026-05-25T12:00:00+08:00",
    });

    expect(result.manifest.slug).toBe("maze-acfun");
    expect(result.manifest.target).toBe("content/posts/maze-acfun/index.md");
  });

  it("rewrites local assets and records planned copies", () => {
    const result = exportHugoPost({
      doc: acfunDocWithAssets,
      repoRoot: "I:/my-blog",
      dryRun: true,
      now: "2026-05-25T12:00:00+08:00",
      assetBasePath: "I:/siyuan/workspace/data",
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain(
      "![local](images/PixPin_2026-04-27_10-25-12-20260427102514-kze3mcy.png)",
    );
    expect(result.content).toContain("![remote](https://example.com/remote.png)");
    expect(result.manifest.copiedAssets).toEqual([
      "content/posts/acfun/images/PixPin_2026-04-27_10-25-12-20260427102514-kze3mcy.png",
    ]);
    expect(result.assetPlans[0]).toEqual({
      originalUrl: "assets/PixPin_2026-04-27_10-25-12-20260427102514-kze3mcy.png",
      sourcePath: "I:/siyuan/workspace/data/assets/PixPin_2026-04-27_10-25-12-20260427102514-kze3mcy.png",
      targetRelativePath: "content/posts/acfun/images/PixPin_2026-04-27_10-25-12-20260427102514-kze3mcy.png",
      rewrittenUrl: "images/PixPin_2026-04-27_10-25-12-20260427102514-kze3mcy.png",
    });
  });
});
