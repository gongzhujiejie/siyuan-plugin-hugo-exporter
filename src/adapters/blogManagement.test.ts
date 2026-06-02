/**
 * 文件用途：博客管理动作 fs/git 适配层单元测试。
 * 创建日期：2026-06-02
 * 修改日期：2026-06-02
 * 语言版本：TypeScript 5.x
 * 依赖库：vitest、node:fs/promises、node:path、node:os。
 *
 * 安全说明：测试只在临时目录写删文件，并通过 mock 拦截 git 调用，不会影响真实仓库或远端。
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gitMocks = vi.hoisted(() => ({
  exportPushBundleMock: vi.fn(),
  runGitMock: vi.fn(),
}));

const { exportPushBundleMock, runGitMock } = gitMocks;

// NOTE: blogManagement 会复用 git adapter；这里 mock 掉真实 git，确保测试不提交、不推送。
//       vi.mock 会被 Vitest 提升到文件顶部，因此 mock 函数必须用 vi.hoisted 提前创建。
vi.mock("./git", () => ({
  exportPushBundle: gitMocks.exportPushBundleMock,
  runGit: gitMocks.runGitMock,
}));

import {
  createBlogManagementCommitMessage,
  performBlogManagementGitPush,
  removePostBundle,
  writePostIndex,
} from "./blogManagement";

/** makeOkGitResult 构造 git 成功返回，便于断言流程中每一步参数。 */
function makeOkGitResult(args: string[], stdout = ""): {
  ok: true;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: 0;
} {
  return { ok: true, command: "git", args, stdout, stderr: "", exitCode: 0 };
}

describe("writePostIndex", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hugo-blog-management-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("安全创建 bundle 目录并写入 index.md", async () => {
    const result = await writePostIndex(root, "content/posts/acfun/index.md", "---\ntitle: Acfun\n---\n");

    const written = await readFile(join(root, "content", "posts", "acfun", "index.md"), "utf8");
    expect(written).toBe("---\ntitle: Acfun\n---\n");
    expect(result.relativeIndexPath).toBe("content/posts/acfun/index.md");
    expect(result.written).toBe(true);
  });

  it("拒绝通过 ../ 将 index.md 写出 repoRoot", async () => {
    await expect(writePostIndex(root, "../evil/index.md", "evil")).rejects.toThrow(
      "Refuse to write outside repository",
    );
  });
});

describe("removePostBundle", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hugo-blog-management-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("安全删除整个 post bundle 目录", async () => {
    const bundleDir = join(root, "content", "posts", "acfun");
    await mkdir(join(bundleDir, "images"), { recursive: true });
    await writeFile(join(bundleDir, "index.md"), "body", "utf8");
    await writeFile(join(bundleDir, "images", "cover.png"), "fake", "utf8");

    const result = await removePostBundle(root, "content/posts/acfun");

    expect(result.removed).toBe(true);
    expect(existsSync(bundleDir)).toBe(false);
  });

  it("拒绝空路径、根目录和 ../ 逃逸删除", async () => {
    await expect(removePostBundle(root, "")).rejects.toThrow("Refuse to remove repository root");
    await expect(removePostBundle(root, ".")).rejects.toThrow("Refuse to remove repository root");
    await expect(removePostBundle(root, "../evil")).rejects.toThrow("Refuse to remove outside repository");
  });
});

describe("createBlogManagementCommitMessage", () => {
  it("生成博客管理动作提交消息", () => {
    expect(createBlogManagementCommitMessage("unpublish", "acfun")).toBe("post: unpublish acfun");
    expect(createBlogManagementCommitMessage("republish", "acfun")).toBe("post: republish acfun");
    expect(createBlogManagementCommitMessage("delete", "acfun")).toBe("post: delete acfun");
  });
});

describe("performBlogManagementGitPush", () => {
  beforeEach(() => {
    exportPushBundleMock.mockReset();
    runGitMock.mockReset();
  });

  it("bundle 模式包装 exportPushBundle，并让 git add 路径保持为 bundle 目录", async () => {
    exportPushBundleMock.mockResolvedValue({ ok: true, committed: true, pushed: true, steps: [] });

    const result = await performBlogManagementGitPush({
      binary: "git",
      repoRoot: "I:/my-blog",
      bundleRelativeDir: "content/posts/acfun",
      action: "delete",
      slug: "acfun",
      remote: "origin",
      branch: "main",
      pullBeforePush: false,
    });

    expect(result.ok).toBe(true);
    expect(exportPushBundleMock).toHaveBeenCalledWith({
      binary: "git",
      repoRoot: "I:/my-blog",
      bundleRelativeDir: "content/posts/acfun",
      remote: "origin",
      branch: "main",
      commitMessage: "post: delete acfun",
      pullBeforePush: false,
    });
  });

  it("index 模式调用 git add 的路径为 indexPath", async () => {
    runGitMock
      .mockResolvedValueOnce(makeOkGitResult(["rev-parse", "--show-toplevel"]))
      .mockResolvedValueOnce(makeOkGitResult(["status", "--porcelain", "--", "content/posts/acfun/index.md"], " M content/posts/acfun/index.md\n"))
      .mockResolvedValueOnce(makeOkGitResult(["add", "--", "content/posts/acfun/index.md"]))
      .mockResolvedValueOnce(makeOkGitResult(["commit", "-m", "post: republish acfun", "--", "content/posts/acfun/index.md"]))
      .mockResolvedValueOnce(makeOkGitResult(["push", "origin", "main"]));

    const result = await performBlogManagementGitPush({
      binary: "git",
      repoRoot: "I:/my-blog",
      indexPath: "content/posts/acfun/index.md",
      action: "republish",
      slug: "acfun",
      remote: "origin",
      branch: "main",
      pullBeforePush: false,
    });

    expect(result.ok).toBe(true);
    expect(runGitMock).toHaveBeenCalledWith({
      binary: "git",
      cwd: "I:/my-blog",
      args: ["add", "--", "content/posts/acfun/index.md"],
    });
  });
});
