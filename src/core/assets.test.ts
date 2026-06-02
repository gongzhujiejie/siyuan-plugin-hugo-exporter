import { describe, expect, it } from "vitest";
import { planFrontmatterImageAsset, planMarkdownAssets, sanitizeAssetFileName } from "./assets";

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

describe("planFrontmatterImageAsset", () => {
  const baseInput = {
    assetBasePath: "I:/siyuan/workspace/data",
    relativeAssetDir: "content/posts/acfun/images",
    publicAssetDir: "images",
    existingTargetNames: new Set<string>(),
  };

  it("returns empty value untouched", () => {
    const result = planFrontmatterImageAsset({ ...baseInput, rawValue: "" });
    expect(result.rewrittenValue).toBe("");
    expect(result.assetPlan).toBeUndefined();
  });

  it("keeps remote URLs as-is", () => {
    const result = planFrontmatterImageAsset({
      ...baseInput,
      rawValue: "https://cdn.example.com/cover.png",
    });
    expect(result.rewrittenValue).toBe("https://cdn.example.com/cover.png");
    expect(result.assetPlan).toBeUndefined();
  });

  it("keeps already-bundled relative path untouched", () => {
    const result = planFrontmatterImageAsset({ ...baseInput, rawValue: "images/cover.png" });
    expect(result.rewrittenValue).toBe("images/cover.png");
    expect(result.assetPlan).toBeUndefined();
  });

  it("plans a copy from a Windows absolute path", () => {
    const result = planFrontmatterImageAsset({ ...baseInput, rawValue: "D:/covers/spring.png" });
    expect(result.rewrittenValue).toBe("images/spring.png");
    expect(result.assetPlan).toEqual({
      originalUrl: "D:/covers/spring.png",
      sourcePath: "D:/covers/spring.png",
      targetRelativePath: "content/posts/acfun/images/spring.png",
      rewrittenUrl: "images/spring.png",
    });
  });

  it("plans a copy from a siyuan assets/ relative path", () => {
    const result = planFrontmatterImageAsset({ ...baseInput, rawValue: "assets/spring.png" });
    expect(result.rewrittenValue).toBe("images/spring.png");
    expect(result.assetPlan).toEqual({
      originalUrl: "assets/spring.png",
      sourcePath: "I:/siyuan/workspace/data/assets/spring.png",
      targetRelativePath: "content/posts/acfun/images/spring.png",
      rewrittenUrl: "images/spring.png",
    });
  });

  it("plans a copy from a file:// URL", () => {
    const result = planFrontmatterImageAsset({
      ...baseInput,
      rawValue: "file:///I:/siyuan/assets/spring.png",
    });
    expect(result.rewrittenValue).toBe("images/spring.png");
    expect(result.assetPlan?.sourcePath).toBe("I:/siyuan/assets/spring.png");
  });

  it("renames target when name conflicts with existing", () => {
    const result = planFrontmatterImageAsset({
      ...baseInput,
      rawValue: "D:/covers/cover.png",
      existingTargetNames: new Set(["cover.png"]),
    });
    expect(result.rewrittenValue).toBe("images/cover-1.png");
    expect(result.assetPlan?.targetRelativePath).toBe("content/posts/acfun/images/cover-1.png");
  });

  it("preserves POSIX absolute path as Hugo static reference (no copy)", () => {
    const result = planFrontmatterImageAsset({ ...baseInput, rawValue: "/images/cover.png" });
    expect(result.rewrittenValue).toBe("/images/cover.png");
    expect(result.assetPlan).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
