/**
 * 文件用途：博客管理动作的 fs/git 适配层，服务于取消发布、重新发布、删除等 post bundle 操作。
 * 创建日期：2026-06-02
 * 修改日期：2026-06-02
 * 语言版本：TypeScript 5.x
 * 依赖库：node:fs/promises、node:path、现有 git adapter。
 *
 * 安全说明：
 * - 所有文件写入和目录删除都必须先把目标路径解析到 repoRoot 内，拒绝 ../ 与绝对路径逃逸。
 * - 删除动作额外拒绝空路径、`.` 和仓库根目录，避免误删整个 Hugo 仓库。
 * - git 调用复用现有 spawn 参数数组封装，不经 shell 拼接，避免命令注入。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { exportPushBundle, runGit, type ExportPushResult, type ExportPushStep } from "./git";

/** BlogManagementAction 限定博客管理动作，提交消息只允许这三类受控动词。 */
export type BlogManagementAction = "unpublish" | "republish" | "delete";

/** WritePostIndexResult 描述 index.md 写入结果，供上层记录日志或 toast。 */
export interface WritePostIndexResult {
  written: boolean;
  absolutePath: string;
  relativeIndexPath: string;
}

/** RemovePostBundleResult 描述 bundle 删除结果，force 删除不存在目录时也视为完成。 */
export interface RemovePostBundleResult {
  removed: boolean;
  absolutePath: string;
  bundleRelativeDir: string;
}

/** PerformBlogManagementGitPushInput 是博客管理动作提交并推送的统一输入。 */
export interface PerformBlogManagementGitPushInput {
  binary: string;
  repoRoot: string;
  /** bundleRelativeDir 存在时按整个 leaf bundle 做 git status/add/commit。 */
  bundleRelativeDir?: string;
  /** indexPath 存在且没有 bundleRelativeDir 时，仅提交 index.md 这一条路径。 */
  indexPath?: string;
  action: BlogManagementAction;
  slug: string;
  remote: string;
  branch: string;
  pullBeforePush: boolean;
  /** commitMessage 允许调用方覆盖；默认由 action + slug 生成规范消息。 */
  commitMessage?: string;
}

/** ensureInsideRepoBoundary 返回目标路径相对仓库根的位置，非法时抛错。 */
function ensureInsideRepoBoundary(repoRoot: string, targetPath: string, errorPrefix: string): string {
  const root = resolve(repoRoot);
  const target = resolve(targetPath);
  const rel = relative(root, target);

  // NOTE: rel 为空或 `.` 代表目标就是 repoRoot；写入/删除动作都不允许把根目录当目标。
  if (rel === "" || rel === ".") {
    throw new Error(`${errorPrefix} repository root: ${target}`);
  }
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${errorPrefix} outside repository: ${target}`);
  }
  return rel;
}

/** resolveRelativeTarget 把用户传入的相对路径解析为安全的绝对路径与 repo 内相对路径。 */
function resolveRelativeTarget(repoRoot: string, relativePath: string, errorPrefix: string): { absolutePath: string; repoRelativePath: string } {
  const trimmed = (relativePath ?? "").trim();
  if (!trimmed) {
    throw new Error(`${errorPrefix} repository root: ${resolve(repoRoot)}`);
  }

  // NOTE: 使用 resolve(repoRoot, trimmed) 而不是字符串拼接；绝对路径会自然脱离 root 并被边界校验拒绝。
  const absolutePath = resolve(repoRoot, trimmed);
  const repoRelativePath = ensureInsideRepoBoundary(repoRoot, absolutePath, errorPrefix);
  return { absolutePath, repoRelativePath: toGitPath(repoRelativePath) };
}

/** toGitPath 将 Windows 反斜杠转为 git pathspec 更稳定的正斜杠。 */
function toGitPath(path: string): string {
  return path.replace(/\\/g, "/");
}

/** trimFirstLine 提取 git 错误首行，避免把大段日志直接抛给 UI。 */
function trimFirstLine(text: string): string {
  if (!text) return "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/** failedGitResult 将失败步骤包装成 ExportPushResult，保持与 git adapter 返回结构兼容。 */
function failedGitResult(
  failedStep: string,
  steps: ExportPushStep[],
  errorMessage: string,
  committed = false,
): ExportPushResult {
  return { ok: false, committed, pushed: false, failedStep, steps, errorMessage };
}

/**
 * writePostIndex 安全写入 post bundle 的 index.md。
 * 输入：repoRoot、仓库内相对 index 路径、文件内容。
 * 返回：写入结果和最终绝对路径。
 */
export async function writePostIndex(repoRoot: string, relativeIndexPath: string, content: string): Promise<WritePostIndexResult> {
  const target = resolveRelativeTarget(repoRoot, relativeIndexPath, "Refuse to write");

  // NOTE: 博客管理动作只应该改 leaf bundle 的 index.md，防止误把资源或其他配置当正文覆盖。
  if (basename(target.absolutePath) !== "index.md") {
    throw new Error(`Refuse to write non-index file: ${target.absolutePath}`);
  }

  await mkdir(dirname(target.absolutePath), { recursive: true });
  await writeFile(target.absolutePath, content, "utf8");
  return { written: true, absolutePath: target.absolutePath, relativeIndexPath: target.repoRelativePath };
}

/**
 * removePostBundle 安全删除整个 post bundle 目录。
 * 输入：repoRoot、仓库内 bundle 相对目录。
 * 返回：删除结果；目录不存在时 force=true 仍返回 removed=true。
 */
export async function removePostBundle(repoRoot: string, bundleRelativeDir: string): Promise<RemovePostBundleResult> {
  const target = resolveRelativeTarget(repoRoot, bundleRelativeDir, "Refuse to remove");

  // NOTE: rm recursive 只在通过边界校验后执行；禁止空路径、根目录和父级逃逸已在上方拦截。
  await rm(target.absolutePath, { recursive: true, force: true });
  return { removed: true, absolutePath: target.absolutePath, bundleRelativeDir: target.repoRelativePath };
}

/** createBlogManagementCommitMessage 生成博客管理动作的规范 commit message。 */
export function createBlogManagementCommitMessage(action: BlogManagementAction, slug: string): string {
  const safeSlug = (slug ?? "").trim();
  if (!safeSlug) {
    throw new Error("Refuse to create blog management commit message without slug");
  }
  return `post: ${action} ${safeSlug}`;
}

/** runPathScopedGitPush 对单一路径执行 status/add/commit/push，供 indexPath 模式复用。 */
async function runPathScopedGitPush(input: Required<Pick<PerformBlogManagementGitPushInput, "binary" | "repoRoot" | "remote" | "branch" | "pullBeforePush">> & {
  pathspec: string;
  commitMessage: string;
}): Promise<ExportPushResult> {
  const steps: ExportPushStep[] = [];

  const verify = await runGit({ binary: input.binary, cwd: input.repoRoot, args: ["rev-parse", "--show-toplevel"] });
  steps.push({ name: "verify-repo", result: verify });
  if (!verify.ok) return failedGitResult("verify-repo", steps, trimFirstLine(verify.stderr) || "git rev-parse failed");

  if (input.pullBeforePush) {
    const pull = await runGit({ binary: input.binary, cwd: input.repoRoot, args: ["pull", "--rebase", input.remote, input.branch] });
    steps.push({ name: "pull-rebase", result: pull });
    if (!pull.ok) return failedGitResult("pull-rebase", steps, trimFirstLine(pull.stderr) || "git pull --rebase failed");
  }

  const status = await runGit({ binary: input.binary, cwd: input.repoRoot, args: ["status", "--porcelain", "--", input.pathspec] });
  steps.push({ name: "status", result: status });
  if (!status.ok) return failedGitResult("status", steps, trimFirstLine(status.stderr) || "git status failed");

  let committed = false;
  if (status.stdout.trim().length > 0) {
    const add = await runGit({ binary: input.binary, cwd: input.repoRoot, args: ["add", "--", input.pathspec] });
    steps.push({ name: "add", result: add });
    if (!add.ok) return failedGitResult("add", steps, trimFirstLine(add.stderr) || "git add failed");

    // NOTE: commit 也附带 pathspec，避免把工作树中其他用户未提交改动纳入本次博客管理提交。
    const commit = await runGit({ binary: input.binary, cwd: input.repoRoot, args: ["commit", "-m", input.commitMessage, "--", input.pathspec] });
    steps.push({ name: "commit", result: commit });
    if (!commit.ok) return failedGitResult("commit", steps, trimFirstLine(commit.stderr) || "git commit failed");
    committed = true;
  }

  const push = await runGit({ binary: input.binary, cwd: input.repoRoot, args: ["push", input.remote, input.branch] });
  steps.push({ name: "push", result: push });
  if (!push.ok) return failedGitResult("push", steps, trimFirstLine(push.stderr || push.stdout) || "git push failed", committed);

  return { ok: true, committed, pushed: true, steps };
}

/**
 * performBlogManagementGitPush 提交并推送博客管理动作。
 * bundleRelativeDir 模式：直接包装现有 exportPushBundle，保持 git add 路径为 bundle 目录。
 * indexPath 模式：按单个 index.md pathspec 执行 git status/add/commit/push。
 */
export async function performBlogManagementGitPush(input: PerformBlogManagementGitPushInput): Promise<ExportPushResult> {
  const commitMessage = input.commitMessage ?? createBlogManagementCommitMessage(input.action, input.slug);

  if (input.bundleRelativeDir) {
    const target = resolveRelativeTarget(input.repoRoot, input.bundleRelativeDir, "Refuse to push");
    return exportPushBundle({
      binary: input.binary,
      repoRoot: input.repoRoot,
      bundleRelativeDir: target.repoRelativePath,
      remote: input.remote,
      branch: input.branch,
      commitMessage,
      pullBeforePush: input.pullBeforePush,
    });
  }

  if (!input.indexPath) {
    return failedGitResult("validate-path", [], "Refuse to push without bundleRelativeDir or indexPath");
  }

  const target = resolveRelativeTarget(input.repoRoot, input.indexPath, "Refuse to push");
  if (basename(target.absolutePath) !== "index.md") {
    return failedGitResult("validate-path", [], `Refuse to push non-index file: ${target.absolutePath}`);
  }

  return runPathScopedGitPush({
    binary: input.binary,
    repoRoot: input.repoRoot,
    remote: input.remote,
    branch: input.branch,
    pullBeforePush: input.pullBeforePush,
    pathspec: target.repoRelativePath,
    commitMessage,
  });
}
