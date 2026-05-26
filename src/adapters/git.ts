/**
 * 文件用途：封装思源插件运行时调用 git 的逻辑。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：node:fs/promises、node:path；node:child_process 仅在执行 git 时懒加载。
 *
 * 安全说明：
 * - 一律使用 spawn + 参数数组调用 git，禁用 shell 解释，避免命令注入。
 * - 所有写入路径都先用 path.relative 校验是否在 repoRoot 内，绝不允许 ../ 逃逸。
 * - 不会执行 reset / checkout / push --force / add . 等破坏性命令。
 */
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";

/** GitCommandResult 是所有 git 调用的统一返回结构。 */
export interface GitCommandResult {
  ok: boolean;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** GitRunOptions 控制单次 git 调用环境。 */
export interface GitRunOptions {
  binary: string;
  cwd: string;
  args: string[];
  /** stdinInput 在某些场景下传入，预留；当前未使用。 */
  stdinInput?: string;
}

/** ExportPushInput 是高层导出推送流程的输入。 */
export interface ExportPushInput {
  binary: string;
  repoRoot: string;
  /** bundleRelativeDir 是 leaf bundle 相对仓库根的目录，例如 content/posts/skid。 */
  bundleRelativeDir: string;
  remote: string;
  branch: string;
  commitMessage: string;
  pullBeforePush: boolean;
}

/** ExportPushStep 描述高层流程中的一个阶段。 */
export interface ExportPushStep {
  name: string;
  result: GitCommandResult;
}

/** ExportPushResult 汇总整个 commit + push 流程，便于 UI 一次性展示日志。 */
export interface ExportPushResult {
  ok: boolean;
  /** committed 表示本次有真实 commit 创建（false 代表 nothing to commit）。 */
  committed: boolean;
  /** pushed 表示是否成功执行 push。 */
  pushed: boolean;
  /** failedStep 给出第一个失败的阶段名，便于 toast 显示。 */
  failedStep?: string;
  steps: ExportPushStep[];
  errorMessage?: string;
}

const WINDOWS_GIT_FALLBACKS = [
  "C:/Program Files/Git/cmd/git.exe",
  "C:/Program Files/Git/bin/git.exe",
  "C:/Program Files (x86)/Git/cmd/git.exe",
  "C:/Program Files (x86)/Git/bin/git.exe",
];

/**
 * resolveGitBinary 解析最终调用的 git 可执行文件路径。
 * 输入：用户在设置里填写的 binary 文本。
 * 返回：绝对路径或可被 spawn 直接识别的命令名（例如 "git"）。
 *
 * 安全说明：未命中绝对路径时回退到 PATH 探测；最坏情况返回 "git"，由 spawn 自行报错，不会执行任意命令。
 */
export async function resolveGitBinary(binary: string): Promise<string> {
  const trimmed = (binary ?? "").trim();
  if (trimmed) {
    if (isAbsolute(trimmed)) {
      if (await canAccess(trimmed)) return trimmed;
      // NOTE: 用户填了绝对路径但访问不到时，仍回退到自动探测，避免直接抛错。
    } else {
      return trimmed;
    }
  }

  const fromPath = await findInPath("git");
  if (fromPath) return fromPath;

  if (isWindowsRuntime()) {
    for (const candidate of WINDOWS_GIT_FALLBACKS) {
      if (await canAccess(candidate)) return candidate;
    }
  }

  return "git";
}

/** canAccess 判断给定路径是否可读，用于探测 git 可执行文件。 */
async function canAccess(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** isWindowsRuntime 不依赖 node:os，避免插件加载时顶层 require('node:os')。 */
function isWindowsRuntime(): boolean {
  const platformValue = typeof process !== "undefined" ? process.platform : "";
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return platformValue === "win32" || /windows/i.test(userAgent);
}

/** findInPath 在 PATH 中查找可执行文件，跨平台返回首个命中。 */
async function findInPath(name: string): Promise<string | null> {
  const pathEnv = process.env.PATH ?? "";
  if (!pathEnv) return null;
  const exts = isWindowsRuntime() ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext.toLowerCase()}`);
      if (await canAccess(candidate)) return candidate;
    }
  }
  return null;
}

type SpawnFn = (command: string, args: string[], options: Record<string, unknown>) => {
  stdout?: { on(event: "data", listener: (chunk: unknown) => void): void };
  stderr?: { on(event: "data", listener: (chunk: unknown) => void): void };
  stdin?: { end(input?: string): void };
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (code: number | null) => void): void;
};

/**
 * getSpawn 在真正执行 git 时才加载 child_process。
 * 这样插件主模块加载阶段不会因为思源运行环境没有 node:child_process 而整体失败。
 */
function getSpawn(): SpawnFn {
  const globalRequire = (globalThis as unknown as { require?: (name: string) => unknown }).require;
  const windowRequire =
    typeof window !== "undefined"
      ? (window as unknown as { require?: (name: string) => unknown }).require
      : undefined;
  const nodeRequire = globalRequire ?? windowRequire;
  if (!nodeRequire) {
    throw new Error("当前思源运行环境不支持 Node require，无法执行 git 推送；请使用桌面端并确认插件可访问 child_process");
  }

  const childProcess = nodeRequire("node:child_process") as { spawn?: SpawnFn };
  if (typeof childProcess.spawn !== "function") {
    throw new Error("当前思源运行环境不支持 child_process.spawn，无法执行 git 推送");
  }
  return childProcess.spawn;
}

/**
 * runGit 同步等待执行单条 git 命令并捕获 stdout/stderr。
 * 输入：GitRunOptions。
 * 返回：GitCommandResult。
 */
export async function runGit(options: GitRunOptions): Promise<GitCommandResult> {
  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";

    let child;
    try {
      const spawn = getSpawn();
      child = spawn(options.binary, options.args, {
        cwd: options.cwd,
        // NOTE: 禁用 shell 解释，所有参数严格按数组传递，避免任何引号/转义问题。
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      resolveResult({
        ok: false,
        command: options.binary,
        args: options.args,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
      });
      return;
    }

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolveResult({
        ok: false,
        command: options.binary,
        args: options.args,
        stdout,
        stderr: stderr || error.message,
        exitCode: null,
      });
    });
    child.on("close", (code) => {
      resolveResult({
        ok: code === 0,
        command: options.binary,
        args: options.args,
        stdout,
        stderr,
        exitCode: code,
      });
    });

    if (options.stdinInput !== undefined) {
      child.stdin?.end(options.stdinInput);
    } else {
      child.stdin?.end();
    }
  });
}

/**
 * isInsideRepoBoundary 校验 bundleRelativeDir 解析后仍在 repoRoot 内。
 * 这是一个纯函数，便于 UI 在显示前预校验。
 */
export function isInsideRepoBoundary(repoRoot: string, bundleRelativeDir: string): boolean {
  if (!bundleRelativeDir) return false;
  const root = resolve(repoRoot);
  const target = resolve(join(repoRoot, bundleRelativeDir));
  const rel = relative(root, target);
  if (rel === "" || rel === ".") return false;
  if (rel.startsWith("..")) return false;
  if (isAbsolute(rel)) return false;
  return true;
}

/**
 * verifyGitRepository 探测 repoRoot 是否是 git 工作区。
 * 用于设置页「测试 Git 连接」按钮以及 push 前防御性检查。
 */
export async function verifyGitRepository(binary: string, repoRoot: string): Promise<GitCommandResult> {
  return runGit({ binary, cwd: repoRoot, args: ["rev-parse", "--show-toplevel"] });
}

/**
 * exportPushBundle 串联 status / add / commit / push 高层流程。
 * 输入：ExportPushInput。
 * 返回：ExportPushResult，包含每一步执行结果与最终是否成功。
 *
 * 安全说明：
 * - 仅 add 单一 bundle 目录，不允许 add . 或父目录。
 * - 任意阶段失败立刻返回，保留本地 commit；不做 reset。
 */
export async function exportPushBundle(input: ExportPushInput): Promise<ExportPushResult> {
  const steps: ExportPushStep[] = [];

  if (!isInsideRepoBoundary(input.repoRoot, input.bundleRelativeDir)) {
    return {
      ok: false,
      committed: false,
      pushed: false,
      failedStep: "validate-bundle",
      steps,
      errorMessage: `Refuse to push outside repository: ${input.bundleRelativeDir}`,
    };
  }

  const verify = await verifyGitRepository(input.binary, input.repoRoot);
  steps.push({ name: "verify-repo", result: verify });
  if (!verify.ok) {
    return {
      ok: false,
      committed: false,
      pushed: false,
      failedStep: "verify-repo",
      steps,
      errorMessage: trimFirstLine(verify.stderr) || "git rev-parse failed",
    };
  }

  if (input.pullBeforePush) {
    const pull = await runGit({
      binary: input.binary,
      cwd: input.repoRoot,
      args: ["pull", "--rebase", input.remote, input.branch],
    });
    steps.push({ name: "pull-rebase", result: pull });
    if (!pull.ok) {
      return {
        ok: false,
        committed: false,
        pushed: false,
        failedStep: "pull-rebase",
        steps,
        errorMessage: trimFirstLine(pull.stderr) || "git pull --rebase failed",
      };
    }
  }

  const status = await runGit({
    binary: input.binary,
    cwd: input.repoRoot,
    args: ["status", "--porcelain", "--", input.bundleRelativeDir],
  });
  steps.push({ name: "status", result: status });
  if (!status.ok) {
    return {
      ok: false,
      committed: false,
      pushed: false,
      failedStep: "status",
      steps,
      errorMessage: trimFirstLine(status.stderr) || "git status failed",
    };
  }

  const hasChanges = status.stdout.trim().length > 0;
  let committed = false;

  if (hasChanges) {
    const add = await runGit({
      binary: input.binary,
      cwd: input.repoRoot,
      args: ["add", "--", input.bundleRelativeDir],
    });
    steps.push({ name: "add", result: add });
    if (!add.ok) {
      return {
        ok: false,
        committed: false,
        pushed: false,
        failedStep: "add",
        steps,
        errorMessage: trimFirstLine(add.stderr) || "git add failed",
      };
    }

    const commit = await runGit({
      binary: input.binary,
      cwd: input.repoRoot,
      // NOTE: 仅传入本次 bundle 目录给 commit，避免把工作树其他改动一起带上。
      args: ["commit", "-m", input.commitMessage, "--", input.bundleRelativeDir],
    });
    steps.push({ name: "commit", result: commit });
    if (!commit.ok) {
      return {
        ok: false,
        committed: false,
        pushed: false,
        failedStep: "commit",
        steps,
        errorMessage: trimFirstLine(commit.stderr) || "git commit failed",
      };
    }
    committed = true;
  }

  const push = await runGit({
    binary: input.binary,
    cwd: input.repoRoot,
    args: ["push", input.remote, input.branch],
  });
  steps.push({ name: "push", result: push });
  if (!push.ok) {
    return {
      ok: false,
      committed,
      pushed: false,
      failedStep: "push",
      steps,
      errorMessage: trimFirstLine(push.stderr || push.stdout) || "git push failed",
    };
  }

  return {
    ok: true,
    committed,
    pushed: true,
    steps,
  };
}

/** trimFirstLine 取 stderr 的首行作为 toast 显示，避免炸出大段日志。 */
function trimFirstLine(text: string): string {
  if (!text) return "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}
