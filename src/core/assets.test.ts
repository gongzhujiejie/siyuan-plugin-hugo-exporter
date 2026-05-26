import { describe, expect, it } from "vitest";
import { planMarkdownAssets, sanitizeAssetFileName } from "./assets";

describe("sanitizeAssetFileName", () => {
  it("keeps only the safe basename when path separators are present", () => {
    expect(sanitizeAssetFileName(String.raw`../PixPin image\\bad.png`)).toBe("bad.png");
  });

  it("keeps SiYuan-style timestamp filenames stable", () => {
    expect(sanitizeAssetFileName("PixPin_2026-04-27_10-25-12-20260427102514-kze3mcy.png")).toBe(
      "PixPin_2026-04-27_10-25-12-20260427102514-kze3mcy.png",
    );
  });
});

describe("planMarkdownAssets", () => {
  it("rewrites local image links to images directory", () => {
    const markdown = "![PixPin](assets/PixPin_2026.png)\n\n正文";
    const result = planMarkdownAssets({
      markdown,
      assetBasePath: "I:/siyuan/workspace/data",
      relativeAssetDir: "content/posts/acfun/images",
      publicAssetDir: "images",
      existingTargetNames: new Set(),
    });

    expect(result.markdown).toBe("![PixPin](images/PixPin_2026.png)\n\n正文");
    expect(result.assetPlans).toEqual([
      {
        originalUrl: "assets/PixPin_2026.png",
        sourcePath: "I:/siyuan/workspace/data/assets/PixPin_2026.png",
        targetRelativePath: "content/posts/acfun/images/PixPin_2026.png",
        rewrittenUrl: "images/PixPin_2026.png",
      },
    ]);
  });

  it("keeps remote and mail links unchanged", () => {
    const markdown = "![remote](https://example.com/a.png)\n[mail](mailto:a@example.com)";
    const result = planMarkdownAssets({
      markdown,
      assetBasePath: "I:/siyuan/workspace/data",
      relativeAssetDir: "content/posts/acfun/images",
      publicAssetDir: "images",
      existingTargetNames: new Set(),
    });

    expect(result.markdown).toBe(markdown);
    expect(result.assetPlans).toEqual([]);
  });

  it("renames duplicate target names", () => {
    const markdown = "![a](assets/foo.png)\n![b](assets/nested/foo.png)";
    const result = planMarkdownAssets({
      markdown,
      assetBasePath: "I:/siyuan/workspace/data",
      relativeAssetDir: "content/posts/acfun/images",
      publicAssetDir: "images",
      existingTargetNames: new Set(),
    });

    expect(result.markdown).toBe("![a](images/foo.png)\n![b](images/foo-1.png)");
    expect(result.assetPlans.map((plan) => plan.targetRelativePath)).toEqual([
      "content/posts/acfun/images/foo.png",
      "content/posts/acfun/images/foo-1.png",
    ]);
  });

  it("rewrites file URLs by using the basename", () => {
    const markdown = "![bar](file:///I:/siyuan/assets/bar.jpg)";
    const result = planMarkdownAssets({
      markdown,
      assetBasePath: "I:/siyuan/workspace/data",
      relativeAssetDir: "content/posts/acfun/images",
      publicAssetDir: "images",
      existingTargetNames: new Set(),
    });

    expect(result.markdown).toBe("![bar](images/bar.jpg)");
    expect(result.assetPlans[0].sourcePath).toBe("I:/siyuan/assets/bar.jpg");
  });
});
