/**
 * 文件用途：插件配置默认值、配置合并与 git 提交消息渲染。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：无运行时依赖。
 */

/** HugoExporterConfig 是插件运行时保存到思源 data storage 的配置。 */
export interface HugoExporterConfig {
  repoRoot: string;
  /** contentDir 是 Hugo 仓库内的内容目录，相对路径，例如 content/posts 或 content/post。 */
  contentDir: string;
  /** assetSubDir 是 leaf bundle 内的资源子目录名，例如 images。 */
  assetSubDir: string;
  assetBasePath: string;
  dryRunDefault: boolean;
  /**
   * defaultFrontmatterYaml 用 YAML 文本形式保存默认 frontmatter，
   * 在导出对话框打开时作为初始内容渲染，魔尊可以再二次编辑。
   */
  defaultFrontmatterYaml: string;
  /** categoryOptions 是分类候选白名单，导出对话框可下拉选择。 */
  categoryOptions: string[];
  /** tagOptions 是标签候选白名单。 */
  tagOptions: string[];
  /** collectionOptions 是合集候选白名单。 */
  collectionOptions: string[];
  /** gitEnabled 控制是否在弹窗中显示「导出并推送」按钮。 */
  gitEnabled: boolean;
  /** gitBinary 留空时由 adapter 自动探测 PATH 中的 git；填写后用绝对路径调用。 */
  gitBinary: string;
  /** gitRemote 是 git push 使用的远端名，常见值是 origin。 */
  gitRemote: string;
  /** gitBranch 是 git push 使用的分支，常见值是 main。 */
  gitBranch: string;
  /** commitMessageTemplate 支持 {slug} {title} {date} 占位符。 */
  commitMessageTemplate: string;
  /** pullBeforePush 是否在推送前 pull --rebase；按当前部署链路默认关闭。 */
  pullBeforePush: boolean;

  // ----------------------- 站点发布（一键到公开 Pages 仓库） -----------------------

  /** autoPublishEnabled 控制是否在「导出并推送」成功后自动跑本地 hugo build → 推 public/。 */
  autoPublishEnabled: boolean;
  /** hugoBinary 留空时由 build adapter 自动探测；否则传绝对路径。 */
  hugoBinary: string;
  /**
   * hugoArgs 是 hugo build 的命令行参数（每行一个）；
   * 默认带 --gc / --minify，并强制 --enableGitInfo=false 避免缺 git 时炸。
   */
  hugoArgs: string[];
  /** pagefindEnabled 控制 hugo build 后是否构建搜索索引。 */
  pagefindEnabled: boolean;
  /** pagefindBinary 留空时尝试 node_modules/@pagefind/{platform}/bin/pagefind_extended(.exe)。 */
  pagefindBinary: string;
  /** publishRepoUrl 是公开 Pages 仓库的 https 地址。 */
  publishRepoUrl: string;
  /** publishBranch 是公开仓库的目标分支，通常是 main。 */
  publishBranch: string;
  /** publishCNAME 留空则不写 CNAME；魔尊用了自定义域名（如 lpppp.xyz）就填进来。 */
  publishCNAME: string;
}

/** DEFAULT_FRONTMATTER_YAML 是符合多数博客主题（FixIt / Hugo 默认）的通用 frontmatter 起步模板。 */
export const DEFAULT_FRONTMATTER_YAML = `description: ""
wordCount: true
math: true
draft: false
`;

/**
 * EXAMPLE_CATEGORY_OPTIONS 等"示例候选"是给新用户参考的，不写进默认配置。
 * 设置页会暴露「加载示例候选项」按钮，点击后才注入到当前用户配置。
 */
export const EXAMPLE_CATEGORY_OPTIONS = ["技术", "随笔", "教程"];
export const EXAMPLE_TAG_OPTIONS = ["前端", "后端", "工具"];
export const EXAMPLE_COLLECTION_OPTIONS: string[] = [];

/**
 * DEFAULT_HUGO_ARGS 是 hugo build 的默认参数。
 * - --gc: 清理孤立资源；
 * - --minify: 压缩 HTML/CSS/JS；
 * - --enableGitInfo=false: 避免在 PATH 没 git 时崩，每次 push 都会重写 lastmod 时间戳影响也不大。
 */
export const DEFAULT_HUGO_ARGS = ["--gc", "--minify", "--enableGitInfo=false"];

/**
 * DEFAULT_PLUGIN_CONFIG 是发布给所有用户的默认值，必须保持"通用且空"。
 * - 路径相关：repoRoot / assetBasePath 留空，用户必须自己填，避免误写到错误目录。
 * - 候选项：默认空数组，免得新用户看到一堆莫名的分类。
 * - 默认 YAML 保留通用模板，对所有 Hugo 主题都适用。
 * - 站点发布相关：autoPublishEnabled 默认关，避免新用户被吓到；URL 留空。
 */
export const DEFAULT_PLUGIN_CONFIG: HugoExporterConfig = {
  repoRoot: "",
  contentDir: "content/posts",
  assetSubDir: "images",
  assetBasePath: "",
  dryRunDefault: false,
  defaultFrontmatterYaml: DEFAULT_FRONTMATTER_YAML,
  categoryOptions: [],
  tagOptions: [],
  collectionOptions: [],
  gitEnabled: true,
  gitBinary: "",
  gitRemote: "origin",
  gitBranch: "main",
  commitMessageTemplate: "post: {slug}",
  pullBeforePush: false,
  autoPublishEnabled: false,
  hugoBinary: "",
  hugoArgs: DEFAULT_HUGO_ARGS,
  pagefindEnabled: true,
  pagefindBinary: "",
  publishRepoUrl: "",
  publishBranch: "main",
  publishCNAME: "",
};

/**
 * mergePluginConfig 合并用户配置与默认值。
 * 输入：可能为空、字段缺失或类型损坏的配置对象。
 * 返回：字段完整、类型正确的 HugoExporterConfig；任何非法类型字段一律回退默认值。
 *
 * 安全说明：旧版 storage 文件可能因为外部编辑被破坏（例如某个数组字段被写成 null），
 *           这里逐字段做类型守护，避免插件加载时 .join / .trim 等调用直接 NPE。
 */
export function mergePluginConfig(input: Partial<HugoExporterConfig> | undefined): HugoExporterConfig {
  const raw = (input ?? {}) as Record<string, unknown>;
  const pickString = (key: keyof HugoExporterConfig): string => {
    const value = raw[key as string];
    return typeof value === "string" ? value : (DEFAULT_PLUGIN_CONFIG[key] as string);
  };
  const pickBool = (key: keyof HugoExporterConfig): boolean => {
    const value = raw[key as string];
    return typeof value === "boolean" ? value : (DEFAULT_PLUGIN_CONFIG[key] as boolean);
  };
  const pickStringArray = (key: keyof HugoExporterConfig): string[] => {
    const value = raw[key as string];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
    return DEFAULT_PLUGIN_CONFIG[key] as string[];
  };

  return {
    repoRoot: pickString("repoRoot"),
    contentDir: pickString("contentDir"),
    assetSubDir: pickString("assetSubDir"),
    assetBasePath: pickString("assetBasePath"),
    dryRunDefault: pickBool("dryRunDefault"),
    defaultFrontmatterYaml: pickString("defaultFrontmatterYaml"),
    categoryOptions: pickStringArray("categoryOptions"),
    tagOptions: pickStringArray("tagOptions"),
    collectionOptions: pickStringArray("collectionOptions"),
    gitEnabled: pickBool("gitEnabled"),
    gitBinary: pickString("gitBinary"),
    gitRemote: pickString("gitRemote"),
    gitBranch: pickString("gitBranch"),
    commitMessageTemplate: pickString("commitMessageTemplate"),
    pullBeforePush: pickBool("pullBeforePush"),
    autoPublishEnabled: pickBool("autoPublishEnabled"),
    hugoBinary: pickString("hugoBinary"),
    hugoArgs: pickStringArray("hugoArgs"),
    pagefindEnabled: pickBool("pagefindEnabled"),
    pagefindBinary: pickString("pagefindBinary"),
    publishRepoUrl: pickString("publishRepoUrl"),
    publishBranch: pickString("publishBranch"),
    publishCNAME: pickString("publishCNAME"),
  };
}

/**
 * parseLinesToOptions 把多行文本解析为去空白、去重的候选列表，
 * 用于把设置面板里的 textarea 内容存回配置数组。
 */
export function parseLinesToOptions(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const item = raw.trim();
    if (!item) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

/** CommitMessageContext 描述 commit 模板可用的占位符上下文。 */
export interface CommitMessageContext {
  slug: string;
  title: string;
  /** date 推荐传 YYYY-MM-DD，过长 ISO 字符串会让 commit 标题变丑。 */
  date: string;
}

const COMMIT_PLACEHOLDER = /\{(slug|title|date)\}/g;

/**
 * renderCommitMessage 用上下文渲染 commit 模板。
 * 输入：模板字符串、上下文。
 * 返回：渲染后的 commit 标题；空模板或渲染后语义为空时回退为 "post: <slug|untitled>"。
 *
 * 安全说明：所有占位符都只替换为字符串，单行化处理避免提交消息被注入换行/控制字符。
 */
export function renderCommitMessage(template: string, ctx: CommitMessageContext): string {
  const fallback = `post: ${ctx.slug?.trim() || "untitled"}`;
  const tpl = (template ?? "").trim() || "post: {slug}";

  let placeholderMatched = false;
  let placeholderHasValue = false;
  const replaced = tpl.replace(COMMIT_PLACEHOLDER, (_match, key: keyof CommitMessageContext) => {
    placeholderMatched = true;
    const value = ctx[key];
    if (value === undefined || value === null) return "";
    // NOTE: 控制字符与换行被替换为空格，避免出现多行 commit 标题或注入参数。
    const sanitized = String(value).replace(/[\r\n\t\u0000-\u001f]+/g, " ").trim();
    if (sanitized) placeholderHasValue = true;
    return sanitized;
  });

  const cleaned = replaced.trim();
  // NOTE: 模板里有占位符但全部被渲染为空（如 slug/title/date 都缺失）→ 用 fallback，避免出现 "post:" 这种半截标题。
  if (placeholderMatched && !placeholderHasValue) {
    return fallback;
  }
  return cleaned || fallback;
}
