import { describe, expect, it } from "vitest";
import { createExportManifest } from "./exportPlan";
import { buildBundlePaths } from "./slug";
import { FIXIT_BLOG_PRESET } from "../presets/fixitBlog";
import type { AssetCopyPlan } from "./types";

describe("createExportManifest", () => {
  it("lists planned directories, index writes, and copied assets", () => {
    const paths = buildBundlePaths("I:/my-blog", "Acfun", FIXIT_BLOG_PRESET);
    const assets: AssetCopyPlan[] = [
      {
        originalUrl: "assets/a.png",
        sourcePath: "I:/siyuan/assets/a.png",
        targetRelativePath: "content/posts/acfun/images/a.png",
        rewrittenUrl: "images/a.png",
      },
    ];

    const manifest = createExportManifest({
      docId: "20260525120000-abcdefg",
      paths,
      dryRun: true,
      now: "2026-05-25T12:00:00+08:00",
      assetPlans: assets,
      skippedAssets: [],
      warnings: [],
    });

    expect(manifest).toEqual({
      runId: "20260525T120000-20260525120000-abcdefg",
      dryRun: true,
      docId: "20260525120000-abcdefg",
      slug: "acfun",
      target: "content/posts/acfun/index.md",
      plannedWrites: ["content/posts/acfun/index.md", "content/posts/acfun/images/a.png"],
      plannedDirectories: ["content/posts/acfun", "content/posts/acfun/images"],
      copiedAssets: ["content/posts/acfun/images/a.png"],
      skippedAssets: [],
      warnings: [],
      createdAt: "2026-05-25T12:00:00+08:00",
    });
  });
});
