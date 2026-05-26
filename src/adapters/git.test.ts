/**
 * 文件用途：git adapter 单元测试。
 * 安全说明：测试只调用纯函数和真实 PATH 探测，不会写入用户仓库或对外发起 push。
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportPushBundle, isInsideRepoBoundary, resolveGitBinary, runGit } from "./git";

// NOTE: git adapter 在插件运行时懒加载 global/window.require；测试环境手动桥接 Node require。
import { createRequire } from "node:module";
(globalThis as unknown as { require?: NodeRequire }).require = createRequire(import.meta.url);

describe("isInsideRepoBoundary", () => {
  it("accepts simple relative bundle directory", () => {
    expect(isInsideRepoBoundary("I:/my-blog", "content/posts/skid")).toBe(true);
  });

  it("rejects parent traversal", () => {
    expect(isInsideRepoBoundary("I:/my-blog", "../evil")).toBe(false);
    expect(isInsideRepoBoundary("I:/my-blog", "content/../../evil")).toBe(false);
  });

  it("rejects empty or root reference", () => {
    expect(isInsideRepoBoundary("I:/my-blog", "")).toBe(false);
    expect(isInsideRepoBoundary("I:/my-blog", ".")).toBe(false);
  });
});

describe("resolveGitBinary", () => {
  it("returns 'git' when nothing is configured and PATH lookup fails", async () => {
    const original = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = await resolveGitBinary("");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    } finally {
      process.env.PATH = original;
    }
  });

  it("keeps non-absolute user input untouched so spawn can resolve it", async () => {
    const result = await resolveGitBinary("git");
    expect(result).toBe("git");
  });
});

describe("runGit", () => {
  it("captures non-zero exit codes without throwing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hugo-git-"));
    try {
      // NOTE: 故意使用不存在的二进制，确保失败时返回结构而不是抛错。
      const result = await runGit({ binary: "definitely-not-a-real-binary", cwd, args: ["--version"] });
      expect(result.ok).toBe(false);
      expect(result.exitCode === null || typeof result.exitCode === "number").toBe(true);
      expect(result.stderr.length).toBeGreaterThan(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("exportPushBundle", () => {
  it("refuses to push when bundle path escapes the repo", async () => {
    const result = await exportPushBundle({
      binary: "git",
      repoRoot: "I:/my-blog",
      bundleRelativeDir: "../evil",
      remote: "origin",
      branch: "main",
      commitMessage: "post: skid",
      pullBeforePush: false,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe("validate-bundle");
    expect(result.steps).toHaveLength(0);
    expect(result.errorMessage ?? "").toContain("Refuse to push");
  });

  it("returns verify-repo failure when binary is unreachable", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hugo-git-"));
    try {
      const result = await exportPushBundle({
        binary: "definitely-not-a-real-binary",
        repoRoot: cwd,
        bundleRelativeDir: "content/posts/skid",
        remote: "origin",
        branch: "main",
        commitMessage: "post: skid",
        pullBeforePush: false,
      });
      expect(result.ok).toBe(false);
      expect(result.failedStep).toBe("verify-repo");
      expect(result.committed).toBe(false);
      expect(result.pushed).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
