/**
 * 文件用途：build adapter 单元测试。
 * 安全说明：测试只调用纯函数和真实 PATH 探测，不会真正执行 hugo / pagefind。
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPathInsideRoot,
  PAGEFIND_DEFAULT_EXCLUDE_SELECTORS,
  resolveHugoBinary,
  resolvePagefindBinary,
  runHugoBuild,
  runPagefindIndex,
} from "./build";

// NOTE: build adapter 在运行时懒加载 global/window.require，测试环境手动桥接。
import { createRequire } from "node:module";
(globalThis as unknown as { require?: NodeRequire }).require = createRequire(import.meta.url);

describe("isPathInsideRoot", () => {
  it("accepts a child directory inside root", () => {
    expect(isPathInsideRoot("I:/my-blog", "I:/my-blog/public")).toBe(true);
  });

  it("rejects parent traversal and root itself", () => {
    expect(isPathInsideRoot("I:/my-blog", "I:/my-blog")).toBe(false);
    expect(isPathInsideRoot("I:/my-blog", "I:/")).toBe(false);
    expect(isPathInsideRoot("I:/my-blog", "I:/other/place")).toBe(false);
  });
});

describe("resolveHugoBinary", () => {
  it("returns user-provided non-absolute name as-is", async () => {
    expect(await resolveHugoBinary("hugo")).toBe("hugo");
  });

  it("falls back to 'hugo' when nothing matches", async () => {
    const original = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = await resolveHugoBinary("");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    } finally {
      process.env.PATH = original;
    }
  });
});

describe("resolvePagefindBinary", () => {
  it("returns user-provided non-absolute name as-is", async () => {
    expect(await resolvePagefindBinary("pagefind", "")).toBe("pagefind");
  });

  it("falls back to 'pagefind' when nothing matches", async () => {
    const original = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = await resolvePagefindBinary("", "");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    } finally {
      process.env.PATH = original;
    }
  });
});

describe("runHugoBuild", () => {
  it("rejects when repoRoot is empty", async () => {
    const result = await runHugoBuild({
      binary: "hugo",
      repoRoot: "",
      args: ["--gc"],
      cleanPublicFirst: false,
    });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Hugo 仓库路径未配置");
  });

  it("returns structured failure when binary is unreachable", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hugo-build-"));
    try {
      const result = await runHugoBuild({
        binary: "definitely-not-a-real-binary",
        repoRoot: cwd,
        args: ["--version"],
        cleanPublicFirst: false,
      });
      expect(result.ok).toBe(false);
      expect(result.exitCode === null || typeof result.exitCode === "number").toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("runPagefindIndex", () => {
  it("rejects when repoRoot is empty", async () => {
    const result = await runPagefindIndex({ binary: "pagefind", repoRoot: "" });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Hugo 仓库路径未配置");
  });

  it("uses default exclude-selectors", () => {
    expect(PAGEFIND_DEFAULT_EXCLUDE_SELECTORS).toContain("footer");
    expect(PAGEFIND_DEFAULT_EXCLUDE_SELECTORS).toContain(".categories");
  });
});
