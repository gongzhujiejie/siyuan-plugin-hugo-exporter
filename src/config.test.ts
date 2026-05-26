import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRONTMATTER_YAML,
  DEFAULT_PLUGIN_CONFIG,
  mergePluginConfig,
  parseLinesToOptions,
  renderCommitMessage,
} from "./config";

describe("mergePluginConfig", () => {
  it("uses safe defaults for a first install", () => {
    expect(mergePluginConfig(undefined)).toEqual(DEFAULT_PLUGIN_CONFIG);
  });

  it("keeps user configured repository, content dir and asset dir", () => {
    expect(
      mergePluginConfig({
        repoRoot: "D:/blog",
        contentDir: "content/post",
        assetSubDir: "img",
        assetBasePath: "D:/SiYuan/workspace/data",
        dryRunDefault: true,
      }),
    ).toEqual({
      ...DEFAULT_PLUGIN_CONFIG,
      repoRoot: "D:/blog",
      contentDir: "content/post",
      assetSubDir: "img",
      assetBasePath: "D:/SiYuan/workspace/data",
      dryRunDefault: true,
    });
  });

  it("respects custom default frontmatter yaml", () => {
    expect(
      mergePluginConfig({
        defaultFrontmatterYaml: "draft: false\n",
      }).defaultFrontmatterYaml,
    ).toBe("draft: false\n");
  });

  it("keeps default values stable", () => {
    expect(DEFAULT_PLUGIN_CONFIG.defaultFrontmatterYaml).toBe(DEFAULT_FRONTMATTER_YAML);
  });
});

describe("parseLinesToOptions", () => {
  it("trims and deduplicates", () => {
    expect(parseLinesToOptions("MAZESEC\n MAZESEC \n渗透测试\n\n  ")).toEqual(["MAZESEC", "渗透测试"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseLinesToOptions("")).toEqual([]);
  });
});

describe("renderCommitMessage", () => {
  const ctx = { slug: "skid", title: "Skid", date: "2025-12-02" };

  it("renders default template", () => {
    expect(renderCommitMessage("post: {slug}", ctx)).toBe("post: skid");
  });

  it("supports multiple placeholders", () => {
    expect(renderCommitMessage("post({slug}): {title} @ {date}", ctx)).toBe("post(skid): Skid @ 2025-12-02");
  });

  it("falls back when template is empty or whitespace", () => {
    expect(renderCommitMessage("   ", ctx)).toBe("post: skid");
    expect(renderCommitMessage("", ctx)).toBe("post: skid");
  });

  it("strips newlines and control characters from values", () => {
    expect(renderCommitMessage("post: {title}", { ...ctx, title: "Skid\n--force" })).toBe("post: Skid --force");
  });

  it("falls back to untitled when slug missing on empty template", () => {
    expect(renderCommitMessage("", { slug: "", title: "", date: "" })).toBe("post: untitled");
  });
});

describe("DEFAULT_PLUGIN_CONFIG git defaults", () => {
  it("ships with safe git defaults", () => {
    expect(DEFAULT_PLUGIN_CONFIG.gitEnabled).toBe(true);
    expect(DEFAULT_PLUGIN_CONFIG.gitRemote).toBe("origin");
    expect(DEFAULT_PLUGIN_CONFIG.gitBranch).toBe("main");
    expect(DEFAULT_PLUGIN_CONFIG.commitMessageTemplate).toBe("post: {slug}");
    expect(DEFAULT_PLUGIN_CONFIG.pullBeforePush).toBe(false);
    expect(DEFAULT_PLUGIN_CONFIG.gitBinary).toBe("");
  });
});
