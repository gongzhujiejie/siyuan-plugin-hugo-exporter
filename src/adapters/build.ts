/**
 * 文件用途：封装思源插件运行时调用 hugo / pagefind 的逻辑。
 * 创建日期：2026-05-26
 * 修改日期：2026-05-26
 * 语言版本：TypeScript 5.x
 * 依赖库：node:child_process 仅在真正构建时懒加载；node:fs/promises 用于清理 public/。
 *
 * 安全说明：
 * - 一律使用 spawn + 参数数组调用，禁用 shell，避免命令注入；
 * - public/ 目录路径必须在 repoRoot 内，使用 path.relative 校验；
 * - 任何二进制路径绝不来自非配置来源，配置层的字符串守护已在 mergePluginConfig 完成。
 */
import { access, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

// SPLICE_1_TYPES

/** BuildCommandResult 是所有构建命令调用的统一返回结构。 */
export interface BuildCommandResult {
  ok: boolean;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** RunHugoBuildInput 是 hugo build 的高层输入。 */
export interface RunHugoBuildInput {
  /** binary 是 hugo 可执行文件路径；空字符串时调用方应先用 resolveHugoBinary 解析。 */
  binary: string;
  /** repoRoot 是 hugo 项目根目录；clean 与 build 都在这里执行。 */
  repoRoot: string;
  /** args 是 hugo build 命令行参数，一般来自配置 hugoArgs。 */
  args: string[];
  /** cleanPublicFirst 控制构建前是否先清空 public/，避免老文件残留。 */
  cleanPublicFirst: boolean;
}

/** RunPagefindInput 是 pagefind 索引构建的高层输入。 */
export interface RunPagefindInput {
  /** binary 是 pagefind 可执行文件路径；空字符串时调用方应先用 resolvePagefindBinary 解析。 */
  binary: string;
  /** repoRoot 是 hugo 项目根目录；--site public 相对它解析。 */
  repoRoot: string;
  /**
   * extraArgs 是额外的 pagefind 参数；默认会带 --site public 与一组通用 exclude-selectors。
   */
  extraArgs?: string[];
}

// SPLICE_2_SPAWN_HELPER

type SpawnFn = (command: string, args: string[], options: Record<string, unknown>) => {
  stdout?: { on(event: "data", listener: (chunk: unknown) => void): void };
  stderr?: { on(event: "data", listener: (chunk: unknown) => void): void };
  stdin?: { end(input?: string): void };
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (code: number | null) => void): void;
};

/**
 * getSpawn 在真正执行命令时才加载 child_process。
 * 与 git adapter 共用同一思路：避免插件主模块加载阶段就 require 一个浏览器没有的 Node 内置。
 */
function getSpawn(): SpawnFn {
  const globalRequire = (globalThis as unknown as { require?: (name: string) => unknown }).require;
  const windowRequire =
    typeof window !== "undefined"
      ? (window as unknown as { require?: (name: string) => unknown }).require
      : undefined;
  const nodeRequire = globalRequire ?? windowRequire;
  if (!nodeRequire) {
    throw new Error("当前思源运行环境不支持 Node require，无法执行本地构建命令");
  }
  const childProcess = nodeRequire("node:child_process") as { spawn?: SpawnFn };
  if (typeof childProcess.spawn !== "function") {
    throw new Error("当前思源运行环境不支持 child_process.spawn，无法执行本地构建命令");
  }
  return childProcess.spawn;
}

/**
 * runCommand 是 hugo / pagefind 共用的最小执行器。
 * - shell:false：不走系统 shell，参数严格按数组传递；
 * - utf8 解码：先收 Buffer 再 concat，避免按 chunk 解多字节字符切断；
 * - 出错时仍返回结构化结果，调用方根据 ok 字段判断。
 */
async function runCommand(
  binary: string,
  args: string[],
  cwd: string,
): Promise<BuildCommandResult> {
  return new Promise((resolveResult) => {
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    const decode = (chunks: Uint8Array[]): string => {
      if (chunks.length === 0) return "";
      try {
        return Buffer.concat(chunks).toString("utf8");
      } catch {
        return chunks.map((chunk) => Buffer.from(chunk).toString("utf8")).join("");
      }
    };

    let child;
    try {
      const spawn = getSpawn();
      child = spawn(binary, args, { cwd, shell: false, windowsHide: true });
    } catch (error) {
      resolveResult({
        ok: false,
        command: binary,
        args,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
      });
      return;
    }

    child.stdout?.on("data", (chunk) => stdoutChunks.push(chunk as Uint8Array));
    child.stderr?.on("data", (chunk) => stderrChunks.push(chunk as Uint8Array));
    child.on("error", (error) => {
      resolveResult({
        ok: false,
        command: binary,
        args,
        stdout: decode(stdoutChunks),
        stderr: decode(stderrChunks) || error.message,
        exitCode: null,
      });
    });
    child.on("close", (code) => {
      resolveResult({
        ok: code === 0,
        command: binary,
        args,
        stdout: decode(stdoutChunks),
        stderr: decode(stderrChunks),
        exitCode: code,
      });
    });

    child.stdin?.end();
  });
}

// SPLICE_3_RESOLVE_BINARY

const WINDOWS_HUGO_FALLBACKS = [
  "C:/Program Files/Hugo/hugo.exe",
  "C:/Hugo/hugo.exe",
  "C:/tools/hugo/hugo.exe",
];

/**
 * canAccess 探测路径是否可读。失败一律视为"不可用"。
 *
 * NOTE: 必须用顶层 import 的 access，不能用 dynamic import("node:fs/promises")。
 *       在思源 Electron renderer 下 dynamic import("node:...") 会失败（对应模块不会被
 *       浏览器 ESM 解析器认作内置），导致所有候选都被判定为不存在，pagefind 找不到。
 *       这一点已经在 git adapter 上得到验证 —— 顶层 import 没问题，dynamic import 不行。
 */
async function canAccess(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** findInPath 是 PATH-based 二进制查找；与 git adapter 重复但暂不抽公共依赖，保持对偶清晰。 */
async function findInPath(name: string): Promise<string | null> {
  const pathEnv = process.env.PATH ?? "";
  if (!pathEnv) return null;
  // NOTE: 思源 Electron 渲染进程里 process.platform 可能不可靠；
  //       两种分隔符都试，两组扩展名都试，确保 Windows 与 Unix 都能命中。
  const exts = [".exe", ".cmd", ".bat", ""];
  const separators = [";", ":"];
  const dirs = new Set<string>();
  for (const sep of separators) {
    for (const dir of pathEnv.split(sep)) {
      if (dir) dirs.add(dir);
    }
  }
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`);
      if (await canAccess(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * resolveHugoBinary 解析 hugo 可执行文件最终路径。
 * 输入：用户配置 binary（可能为空）。
 * 返回：可被 spawn 直接识别的命令名或绝对路径；最坏情况返回 "hugo"。
 *
 * 与 pagefind 同理：思源 Electron 渲染进程里 process.platform 可能不可靠，
 * 所以 PATH 探测时尝试带 .exe / 不带 两种文件名。
 */
export async function resolveHugoBinary(binary: string): Promise<string> {
  const trimmed = (binary ?? "").trim();
  if (trimmed) {
    if (isAbsolute(trimmed)) {
      if (await canAccess(trimmed)) return trimmed;
      // NOTE: 用户填了绝对路径但访问不到时，回退到 PATH 探测，避免直接抛错。
    } else {
      return trimmed;
    }
  }
  const fromPath = await findInPath("hugo");
  if (fromPath) return fromPath;
  // Windows fallback：常见安装路径，外加 .exe / 无后缀都试一遍
  for (const candidate of WINDOWS_HUGO_FALLBACKS) {
    if (await canAccess(candidate)) return candidate;
  }
  return "hugo";
}

/**
 * resolvePagefindBinary 解析 pagefind 可执行文件路径。
 * 思路（按优先级）：
 *   1. 用户填写的非空 binary（绝对路径可访问 / 命令名）；
 *   2. <repoRoot>/node_modules/@pagefind/{platform}/bin/pagefind_extended[.exe]；
 *   3. PATH 中的 pagefind；
 *   4. 兜底返回 "pagefind"，由 spawn 报错。
 *
 * 实现细节：思源 Electron 渲染进程里 process.platform 可能为空字符串，
 *           导致 isWindowsRuntime 误判，无法拼上 .exe 扩展名 → 找不到 Windows 版本的 pagefind。
 *           解决：候选列表把 ".exe" 与 "" 两种后缀都试一遍。
 */
export async function resolvePagefindBinary(binary: string, repoRoot: string): Promise<string> {
  const trimmed = (binary ?? "").trim();
  if (trimmed) {
    if (isAbsolute(trimmed)) {
      if (await canAccess(trimmed)) return trimmed;
    } else {
      return trimmed;
    }
  }
  // 在 repoRoot 下尝试常见 node_modules 路径；同时尝试 .exe 与无扩展，覆盖判断不到 platform 的场景。
  if (repoRoot) {
    const platforms = ["windows-x64", "windows-arm64", "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"];
    const suffixes = [".exe", ""];
    const candidates: string[] = [];
    for (const platform of platforms) {
      for (const suffix of suffixes) {
        candidates.push(
          join(repoRoot, "node_modules", "@pagefind", platform, "bin", `pagefind_extended${suffix}`),
          join(repoRoot, "node_modules", "@pagefind", platform, "bin", `pagefind${suffix}`),
        );
      }
    }
    for (const suffix of suffixes) {
      candidates.push(join(repoRoot, "node_modules", ".bin", `pagefind${suffix}`));
    }
    for (const candidate of candidates) {
      if (await canAccess(candidate)) return candidate;
    }
  }
  const fromPath = await findInPath("pagefind");
  if (fromPath) return fromPath;
  return "pagefind";
}

// SPLICE_4_RUN_HUGO

/** isPathInsideRoot 校验目标路径解析后仍位于 root 内。纯函数，便于单测。 */
export function isPathInsideRoot(rootDir: string, targetPath: string): boolean {
  const root = resolve(rootDir);
  const target = resolve(targetPath);
  const rel = relative(root, target);
  if (rel === "" || rel === ".") return false;
  if (rel.startsWith("..")) return false;
  if (isAbsolute(rel)) return false;
  return true;
}

/**
 * runHugoBuild 执行 hugo --gc --minify 等参数，构建 public/。
 * 输入：RunHugoBuildInput。
 * 返回：BuildCommandResult；ok=false 时调用方应展示 stderr 给用户。
 *
 * 安全说明：
 * - cleanPublicFirst=true 时会 fs.rm public/，先用 isPathInsideRoot 校验路径仍在 repoRoot 内，
 *   避免 repoRoot 配错把整个磁盘删了；
 * - args 直接来自配置层，已被 mergePluginConfig 过滤为 string[]，不会有非字符串注入。
 */
export async function runHugoBuild(input: RunHugoBuildInput): Promise<BuildCommandResult> {
  if (!input.repoRoot) {
    return failureResult(input.binary, input.args, "Hugo 仓库路径未配置，无法构建");
  }

  if (input.cleanPublicFirst) {
    const publicDir = join(input.repoRoot, "public");
    if (!isPathInsideRoot(input.repoRoot, publicDir)) {
      return failureResult(input.binary, input.args, `拒绝清理 public/：路径 ${publicDir} 不在仓库内`);
    }
    try {
      await rm(publicDir, { recursive: true, force: true });
    } catch (error) {
      // NOTE: 如果 public/ 不存在或被占用，忽略不影响后续；hugo 会自己重建。
      console.warn("[hugo-exporter] cleanPublicFirst rm failed", error);
    }
  }

  const args = Array.isArray(input.args) ? input.args.filter((a) => typeof a === "string") : [];
  return runCommand(input.binary, args, input.repoRoot);
}

/** failureResult 构造一个本地校验失败时的 BuildCommandResult，避免调用方处理时还要分辨抛错与返回。 */
function failureResult(binary: string, args: string[], message: string): BuildCommandResult {
  return {
    ok: false,
    command: binary,
    args,
    stdout: "",
    stderr: message,
    exitCode: null,
  };
}

// SPLICE_5_RUN_PAGEFIND

/** PAGEFIND_DEFAULT_EXCLUDE_SELECTORS 与魔尊原 deploy.yml 中的 selectors 保持一致，覆盖 FixIt 的列表页/侧栏文本。 */
export const PAGEFIND_DEFAULT_EXCLUDE_SELECTORS =
  "nav,header,footer,.home-profile,.archives,.categories,.tags,.post-meta,.single.summary";

/**
 * runPagefindIndex 在 hugo build 完成后构建搜索索引。
 * 输入：RunPagefindInput。
 * 返回：BuildCommandResult。
 *
 * 默认 args：["--site","public","--exclude-selectors", PAGEFIND_DEFAULT_EXCLUDE_SELECTORS]
 * 调用方可通过 extraArgs 追加其他参数（例如 --output-path）。
 */
export async function runPagefindIndex(input: RunPagefindInput): Promise<BuildCommandResult> {
  if (!input.repoRoot) {
    return failureResult(input.binary, [], "Hugo 仓库路径未配置，无法构建 pagefind 索引");
  }
  const baseArgs = ["--site", "public", "--exclude-selectors", PAGEFIND_DEFAULT_EXCLUDE_SELECTORS];
  const extra = Array.isArray(input.extraArgs) ? input.extraArgs.filter((a) => typeof a === "string") : [];
  const args = [...baseArgs, ...extra];
  return runCommand(input.binary, args, input.repoRoot);
}
