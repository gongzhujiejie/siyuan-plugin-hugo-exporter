import { describe, expect, it } from "vitest";
import { buildBundlePaths, slugifyTitle } from "./slug";
import { FIXIT_BLOG_PRESET } from "../presets/fixitBlog";

describe("slugifyTitle", () => {
  it("normalizes English titles into lowercase dash slugs", () => {
    expect(slugifyTitle("Hello Hugo Exporter!")).toBe("hello-hugo-exporter");
  });

  it("keeps Chinese characters and removes path separators", () => {
    expect(slugifyTitle(String.raw`靶机 / Acfun \\ Root`)).toBe("靶机-acfun-root");
  });

  it("uses document fallback when title has no safe characters", () => {
    expect(slugifyTitle(String.raw`../\\`)).toBe("untitled");
  });
});

describe("buildBundlePaths", () => {
  it("builds content/posts/<slug>/index.md and images directory", () => {
    const paths = buildBundlePaths("I:/my-blog", "Acfun", FIXIT_BLOG_PRESET);

    expect(paths.slug).toBe("acfun");
    expect(paths.relativeBundleDir).toBe("content/posts/acfun");
    expect(paths.relativeAssetDir).toBe("content/posts/acfun/images");
    expect(paths.relativeIndexPath).toBe("content/posts/acfun/index.md");
    expect(paths.indexPath.replaceAll("\\\\", "/")).toBe("I:/my-blog/content/posts/acfun/index.md");
  });

  it("rejects traversal slugs", () => {
    expect(() => buildBundlePaths("I:/my-blog", "../../evil", FIXIT_BLOG_PRESET)).toThrow("Unsafe slug");
    expect(() => buildBundlePaths("I:/my-blog", "..", FIXIT_BLOG_PRESET)).toThrow("Unsafe slug");
    expect(() => buildBundlePaths("I:/my-blog", "foo/../bar", FIXIT_BLOG_PRESET)).toThrow("Unsafe slug");
    expect(() => buildBundlePaths("I:/my-blog", String.raw`foo\..\bar`, FIXIT_BLOG_PRESET)).toThrow(
      "Unsafe slug",
    );
  });

  it("does not reject titles that merely contain consecutive dots", () => {
    // NOTE: 路径穿越判定按段落，而非整字符串 includes("..")。
    expect(buildBundlePaths("I:/my-blog", "Hello..World", FIXIT_BLOG_PRESET).slug).toBe("hello-world");
    expect(buildBundlePaths("I:/my-blog", "C++..Tips", FIXIT_BLOG_PRESET).slug).toBe("c-tips");
    expect(buildBundlePaths("I:/my-blog", "version 2..3", FIXIT_BLOG_PRESET).slug).toBe("version-2-3");
  });
});
