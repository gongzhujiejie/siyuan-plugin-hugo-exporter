/**
 * 文件用途：思源 Hugo 导出插件入口。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：siyuan、项目 core/adapters/config 模块。
 *
 * NOTE: 在 onload 中先 addIcons 再 addTopBar；Setting 必须在 onload 同步执行
 * 内部完成 addItem，否则思源集市卡片不会出现齿轮按钮。
 */
import { confirm, Menu, Plugin, Setting, showMessage } from "siyuan";
import { access } from "node:fs/promises";
import { copyExportedAssets, writeExportedIndex } from "./adapters/fs";
import {
  exportPushBundle,
  publishPublicSnapshot,
  resolveGitBinary,
  verifyGitRepository,
} from "./adapters/git";
import {
  resolveHugoBinary,
  resolvePagefindBinary,
  runHugoBuild,
  runPagefindIndex,
} from "./adapters/build";
import { hasActiveDocument, NoActiveDocumentError, readCurrentDocumentSnapshot } from "./adapters/siyuan";
import {
  DEFAULT_PLUGIN_CONFIG,
  EXAMPLE_CATEGORY_OPTIONS,
  EXAMPLE_COLLECTION_OPTIONS,
  EXAMPLE_TAG_OPTIONS,
  type HugoExporterConfig,
  mergePluginConfig,
  parseLinesToOptions,
  renderCommitMessage,
} from "./config";
import { exportHugoPost } from "./core/exportPipeline";
import {
  estimateLastFormsBytes,
  type LastFormsMap,
  normalizeLastForms,
  pruneLastForms,
} from "./core/lastForms";
import { openFrontmatterEditor } from "./ui/frontmatterEditor";
import { openProgressDialog, type ProgressDialog } from "./ui/progressDialog";

const STORAGE_NAME = "hugo-exporter-config.json";

/**
 * STORAGE_LAST_FORM 缓存按文档 ID 的最近一次表单填写值，用于 B6 表单字段记忆。
 * v0.2.4 起结构升级为 LastFormsMap = Record<docId, {fields, lastAccessedAt}>，
 * 旧格式（裸 fields 对象）由 normalizeLastForms 自动迁移。
 */
const STORAGE_LAST_FORM = "hugo-exporter-last-form.json";

/** LASTFORM_LIMIT 控制 LRU 容量；超过则按 lastAccessedAt 删最旧的。 */
const LASTFORM_LIMIT = 500;

/** LASTFORM_TTL_DAYS 控制时间淘汰阈值；超过这么多天未访问则清理。 */
const LASTFORM_TTL_DAYS = 90;

/**
 * HUGO_ICON_SVG 注册自定义图标。
 * NOTE: 思源 addIcons 期望的是包在 <svg> 容器里的 symbol 列表；
 * 之前只塞 <symbol> 在部分版本上不会被收录，导致顶栏不显示按钮。
 */
const HUGO_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <symbol id="iconHugoExporter" viewBox="0 0 24 24">
    <path d="M4 3h3v8h6V3h3v18h-3v-7H7v7H4z" fill="currentColor"/>
    <path d="M17 13.6 19.5 12l3 1.6v4.8L19.5 20l-2.5-1.6z" fill="currentColor" opacity="0.85"/>
  </symbol>
</svg>
`;

/** createTextInput 构造思源设置页使用的文本输入框。 */
function createTextInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "b3-text-field fn__block";
  input.value = value;
  return input;
}

/** createCheckbox 构造思源设置页使用的复选框。 */
function createCheckbox(checked: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "b3-switch fn__flex-center";
  input.checked = checked;
  return input;
}

/** createMultilineInput 构造设置页多行文本框，适合 YAML 与候选项列表。 */
function createMultilineInput(value: string, rows: number): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.className = "b3-text-field fn__block";
  textarea.rows = rows;
  textarea.spellcheck = false;
  textarea.style.cssText = "font-family:monospace;font-size:12px;width:100%";
  textarea.value = value;
  return textarea;
}

/** stringifyOptions 把配置数组渲染为设置页每行一项的文本。 */
function stringifyOptions(options: string[]): string {
  return options.join("\n");
}

/**
 * HugoExporterPlugin 是思源插件运行时入口。
 * 当前版本提供：自定义顶栏图标 + 合并导出入口 + 配置页 + dry-run / 正式导出。
 */
export default class HugoExporterPlugin extends Plugin {
  private static readonly VERSION = "0.3.2";
  private config: HugoExporterConfig = DEFAULT_PLUGIN_CONFIG;
  /** lastForms 是按 docId 缓存的最近一次表单填写值；新结构含 lastAccessedAt 时间戳。 */
  private lastForms: LastFormsMap = {};

  /** onload 注册图标、命令、顶栏按钮和设置页。整个流程包 try/catch，便于排查思源运行时差异。 */
  async onload() {
    // NOTE: 启动 toast 用于让魔尊一眼判断当前加载的是新版还是旧缓存版本。
    showMessage(`Hugo 导出器 v${HugoExporterPlugin.VERSION} 已加载`);
    console.log(`[hugo-exporter] onload v${HugoExporterPlugin.VERSION}`);

    try {
      this.addIcons(HUGO_ICON_SVG);
    } catch (error) {
      // NOTE: 部分思源版本对 addIcons 输入要求严格，失败时不能阻断后续注册。
      console.warn("[hugo-exporter] addIcons failed", error);
    }

    try {
      this.config = mergePluginConfig(await this.loadData(STORAGE_NAME));
    } catch (error) {
      console.warn("[hugo-exporter] loadData failed, using defaults", error);
      this.config = DEFAULT_PLUGIN_CONFIG;
    }

    // NOTE: B6 — 加载上次表单缓存；任意失败都不阻断主流程。v0.2.4 起改用 normalizeLastForms 自动迁移旧格式。
    try {
      const saved = await this.loadData(STORAGE_LAST_FORM);
      this.lastForms = normalizeLastForms(saved);
    } catch (error) {
      console.warn("[hugo-exporter] loadData last-form failed", error);
      this.lastForms = {};
    }

    try {
      this.registerSettings();
    } catch (error) {
      console.error("[hugo-exporter] registerSettings failed", error);
      showMessage(`Hugo 插件初始化失败（设置页）：${this.formatError(error)}`);
    }

    try {
      this.registerCommands();
    } catch (error) {
      console.error("[hugo-exporter] registerCommands failed", error);
    }

    try {
      this.registerTopBar();
    } catch (error) {
      console.error("[hugo-exporter] registerTopBar failed", error);
      showMessage(`Hugo 顶栏注册失败：${this.formatError(error)}`);
    }

    // NOTE: 启动后异步淘汰陈旧表单缓存，不阻塞 UI；只跑 TTL + LRU，不调思源 API（避免启动延迟）。
    //       死链淘汰留给设置页里的"清理"按钮主动触发。
    setTimeout(() => {
      try {
        const result = pruneLastForms(this.lastForms, {
          ttlDays: LASTFORM_TTL_DAYS,
          maxEntries: LASTFORM_LIMIT,
        });
        const removedCount =
          result.removed.byTtl.length + result.removed.byLimit.length + result.removed.byMissingDoc.length;
        if (removedCount > 0) {
          this.lastForms = result.pruned;
          void this.saveData(STORAGE_LAST_FORM, this.lastForms);
          console.log(
            `[hugo-exporter] auto-pruned lastForms: ${removedCount} removed (ttl=${result.removed.byTtl.length}, lru=${result.removed.byLimit.length})`,
          );
        }
      } catch (error) {
        console.warn("[hugo-exporter] auto-prune failed", error);
      }
    }, 1500);
  }

  /** formatError 统一序列化错误信息，避免 [object Object] 出现在 toast 中。 */
  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** registerCommands 注册命令面板中的 Hugo 导出命令；预览/写入由弹窗 dry-run 开关决定。 */
  private registerCommands(): void {
    this.addCommand({
      langKey: "hugo-export-current-document",
      hotkey: "",
      callback: () => {
        void this.runExport();
      },
    });
  }

  /** registerTopBar 注册自定义 H 图标，点击弹出 Hugo 导出操作菜单。回退到内嵌文字，避免主题不带 SVG 不显示图标。 */
  private registerTopBar(): void {
    const topBarElement = this.addTopBar({
      icon: "iconHugoExporter",
      title: "Hugo 导出器",
      position: "right",
      callback: (event) => {
        this.openTopBarMenu(event, topBarElement);
      },
    });

    // NOTE: 若思源没渲染出自定义 SVG，给一个文字兜底，确保入口可见。
    if (!topBarElement.querySelector("svg use")) {
      topBarElement.innerHTML = '<span style="font-weight:600;font-size:13px;letter-spacing:0.5px">H↑</span>';
    }
    topBarElement.setAttribute("title", "Hugo 导出器：点击打开菜单");
  }

  /** openTopBarMenu 在顶栏图标位置弹出 Hugo 操作菜单。 */
  private openTopBarMenu(event: MouseEvent, anchorElement: HTMLElement): void {
    const menu = new Menu("hugo-exporter-topbar");

    menu.addItem({
      icon: "iconHugoExporter",
      label: "Hugo：导出当前文档",
      click: () => {
        void this.runExport();
      },
    });

    menu.addSeparator();

    menu.addItem({
      icon: "iconSettings",
      label: "打开 Hugo 导出器设置",
      click: () => {
        this.openSetting();
      },
    });

    const rect = anchorElement.getBoundingClientRect();
    menu.open({
      x: rect.left,
      y: rect.bottom,
      isLeft: false,
    });

    // NOTE: event 仅用于阻止默认事件传播，避免点击穿透到底层文档区域。
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * registerSettings 创建仓库路径、默认 frontmatter、候选项与 git 推送配置。
   *
   * 重要约束（v0.1.8 学到的教训）：
   * - 思源旧版本 Setting.addItem 对 createActionElement 抛错的容错很差，
   *   一项内部异常会让后面所有 addItem 不再渲染（魔尊看到设置页只剩「默认 dry-run」）。
   *   所以这里所有 createActionElement 都必须走 safeAction 守护，不允许向外抛错。
   * - 不要用 direction: "column"；多行文本输入框直接占满 row 即可，避免触发样式 bug。
   * - 顺序：把「测试 Git 连接」放在最前面，让魔尊不需要滚动就能验证 git。
   */
  private registerSettings(): void {
    const inputs: {
      repoRoot?: HTMLInputElement;
      contentDir?: HTMLInputElement;
      assetSubDir?: HTMLInputElement;
      assetBasePath?: HTMLInputElement;
      dryRun?: HTMLInputElement;
      categoryOptions?: HTMLTextAreaElement;
      tagOptions?: HTMLTextAreaElement;
      collectionOptions?: HTMLTextAreaElement;
      defaultFrontmatter?: HTMLTextAreaElement;
      gitEnabled?: HTMLInputElement;
      gitBinary?: HTMLInputElement;
      gitRemote?: HTMLInputElement;
      gitBranch?: HTMLInputElement;
      commitMessage?: HTMLInputElement;
      pullBeforePush?: HTMLInputElement;
      // 站点发布
      autoPublishEnabled?: HTMLInputElement;
      hugoBinary?: HTMLInputElement;
      hugoArgs?: HTMLTextAreaElement;
      pagefindEnabled?: HTMLInputElement;
      pagefindBinary?: HTMLInputElement;
      publishRepoUrl?: HTMLInputElement;
      publishBranch?: HTMLInputElement;
      publishCNAME?: HTMLInputElement;
    } = {};

    this.setting = new Setting({
      width: "760px",
      height: "740px",
      confirmCallback: () => {
        // NOTE: 任一 createActionElement 失败时对应输入会缺失，这里全部走可选链 + 默认值兜底，
        //       保证「保存」按钮永远不会因 undefined 而抛错。
        const fallback = this.config;
        this.config = mergePluginConfig({
          repoRoot: inputs.repoRoot?.value.trim() ?? fallback.repoRoot,
          contentDir: inputs.contentDir?.value.trim() || fallback.contentDir,
          assetSubDir: inputs.assetSubDir?.value.trim() || fallback.assetSubDir,
          assetBasePath: inputs.assetBasePath?.value.trim() ?? fallback.assetBasePath,
          dryRunDefault: inputs.dryRun?.checked ?? fallback.dryRunDefault,
          categoryOptions: inputs.categoryOptions
            ? parseLinesToOptions(inputs.categoryOptions.value)
            : fallback.categoryOptions,
          tagOptions: inputs.tagOptions ? parseLinesToOptions(inputs.tagOptions.value) : fallback.tagOptions,
          collectionOptions: inputs.collectionOptions
            ? parseLinesToOptions(inputs.collectionOptions.value)
            : fallback.collectionOptions,
          defaultFrontmatterYaml: inputs.defaultFrontmatter?.value ?? fallback.defaultFrontmatterYaml,
          gitEnabled: inputs.gitEnabled?.checked ?? fallback.gitEnabled,
          gitBinary: inputs.gitBinary?.value.trim() ?? fallback.gitBinary,
          gitRemote: inputs.gitRemote?.value.trim() || fallback.gitRemote,
          gitBranch: inputs.gitBranch?.value.trim() || fallback.gitBranch,
          commitMessageTemplate:
            inputs.commitMessage?.value.trim() || fallback.commitMessageTemplate,
          pullBeforePush: inputs.pullBeforePush?.checked ?? fallback.pullBeforePush,
          autoPublishEnabled: inputs.autoPublishEnabled?.checked ?? fallback.autoPublishEnabled,
          hugoBinary: inputs.hugoBinary?.value.trim() ?? fallback.hugoBinary,
          hugoArgs: inputs.hugoArgs ? parseLinesToOptions(inputs.hugoArgs.value) : fallback.hugoArgs,
          pagefindEnabled: inputs.pagefindEnabled?.checked ?? fallback.pagefindEnabled,
          pagefindBinary: inputs.pagefindBinary?.value.trim() ?? fallback.pagefindBinary,
          publishRepoUrl: inputs.publishRepoUrl?.value.trim() ?? fallback.publishRepoUrl,
          publishBranch: inputs.publishBranch?.value.trim() || fallback.publishBranch,
          publishCNAME: inputs.publishCNAME?.value.trim() ?? fallback.publishCNAME,
        });
        // NOTE: A4 — saveData 失败必须告知魔尊，避免"保存了实际没落盘"。
        this.saveData(STORAGE_NAME, this.config).then(
          () => showMessage("Hugo Exporter 配置已保存"),
          (error) => {
            console.error("[hugo-exporter] saveData failed", error);
            showMessage(`Hugo Exporter 配置保存失败：${this.formatError(error)}`);
          },
        );
      },
    });

    /**
     * safeAddItem 把每个 addItem 都包成不抛错的形式：createActionElement 内部异常时
     * 用一个红色错误徽章占位，避免连累后续 item 的渲染。
     */
    const safeAddItem = (options: {
      title: string;
      description?: string;
      build: () => HTMLElement;
    }): void => {
      this.setting.addItem({
        title: options.title,
        description: options.description,
        createActionElement: () => {
          try {
            return options.build();
          } catch (error) {
            console.error(`[hugo-exporter] setting item failed: ${options.title}`, error);
            const fallback = document.createElement("span");
            fallback.style.cssText = "color:var(--b3-card-error-color, #d33);font-size:12px";
            fallback.textContent = `加载失败：${this.formatError(error)}`;
            return fallback;
          }
        },
      });
    };

    /**
     * sectionHeader 加一条视觉分隔的章节标题项。
     * 思源 Setting 没暴露分组 API，吾把章节做成一个特殊 item：
     * - title 用粗体大号，颜色用主题强调色；
     * - 不接受用户输入，actionElement 是空的占位。
     */
    const sectionHeader = (title: string, hint = ""): void => {
      this.setting.addItem({
        title,
        description: hint,
        createActionElement: () => {
          const placeholder = document.createElement("div");
          placeholder.style.cssText = "color:var(--b3-theme-on-surface-light);font-size:12px";
          placeholder.textContent = "—";
          return placeholder;
        },
      });
    };

    // ------ 一、仓库与导出基础配置（最先要填的，初次安装必看） ------
    sectionHeader("【一】仓库与导出基础", "首次安装必填；改完点底部「保存」生效");
    safeAddItem({
      title: "Hugo 仓库路径",
      description: "本地 Hugo 仓库根目录的绝对路径，例如 I:/my-blog。",
      build: () => {
        inputs.repoRoot = createTextInput(this.config.repoRoot);
        return inputs.repoRoot;
      },
    });

    safeAddItem({
      title: "内容目录",
      description: "Hugo 仓库内的相对内容目录，例如 content/posts 或 content/post。",
      build: () => {
        inputs.contentDir = createTextInput(this.config.contentDir);
        return inputs.contentDir;
      },
    });

    safeAddItem({
      title: "资源子目录",
      description: "leaf bundle 内放图片/附件的子目录名，例如 images。",
      build: () => {
        inputs.assetSubDir = createTextInput(this.config.assetSubDir);
        return inputs.assetSubDir;
      },
    });

    safeAddItem({
      title: "思源资源根路径",
      description: "用于解析 Markdown 中的 assets/xxx。通常是思源工作空间 data 目录，例如 E:/数据/思源笔记/data。",
      build: () => {
        inputs.assetBasePath = createTextInput(this.config.assetBasePath);
        return inputs.assetBasePath;
      },
    });

    safeAddItem({
      title: "默认 dry-run",
      description: "开启后导出弹窗默认只预览 manifest，不写入文件；弹窗里仍可随时切换。",
      build: () => {
        inputs.dryRun = createCheckbox(this.config.dryRunDefault);
        return inputs.dryRun;
      },
    });

    // ------ 二、候选项与 frontmatter 默认值（导出弹窗里会用到） ------
    sectionHeader("【二】候选项与 frontmatter 默认值", "导出弹窗里 chip / YAML 预填都来自这里");
    safeAddItem({
      title: "分类候选（categories）",
      description: "每行一个分类。导出弹窗里会显示为可点击候选，也可以临时手动输入新分类。",
      build: () => {
        inputs.categoryOptions = createMultilineInput(stringifyOptions(this.config.categoryOptions), 4);
        return inputs.categoryOptions;
      },
    });

    safeAddItem({
      title: "标签候选（tags）",
      description: "每行一个标签。适合维护常用靶机、技术栈、漏洞类型等关键词。",
      build: () => {
        inputs.tagOptions = createMultilineInput(stringifyOptions(this.config.tagOptions), 5);
        return inputs.tagOptions;
      },
    });

    safeAddItem({
      title: "合集候选（collections）",
      description: "每行一个合集。导出弹窗高级字段中可直接选择。",
      build: () => {
        inputs.collectionOptions = createMultilineInput(stringifyOptions(this.config.collectionOptions), 3);
        return inputs.collectionOptions;
      },
    });

    safeAddItem({
      title: "默认 frontmatter（YAML）",
      description: "导出对话框打开时会用这段 YAML 预填字段。title/date/lastmod 始终从思源文档实时取，不会被这里覆盖。",
      build: () => {
        inputs.defaultFrontmatter = createMultilineInput(this.config.defaultFrontmatterYaml, 8);
        return inputs.defaultFrontmatter;
      },
    });

    // ------ 三、Git 推送（可选；启用后导出弹窗会出现「导出并推送」按钮） ------
    sectionHeader("【三】Git 推送（可选）", "启用后才会出现「导出并推送」按钮；推送会触发 GitHub Actions");
    safeAddItem({
      title: "启用 Git 推送",
      description: "开启后导出弹窗会显示「导出并推送」按钮，关闭则只支持本地写入。",
      build: () => {
        inputs.gitEnabled = createCheckbox(this.config.gitEnabled);
        return inputs.gitEnabled;
      },
    });

    safeAddItem({
      title: "测试 Git 连接",
      description:
        "用当前输入框里的「仓库路径 / Git 可执行路径」实时执行 git rev-parse --show-toplevel，无需先点保存。",
      build: () => {
        const wrapper = document.createElement("div");
        wrapper.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap";

        const button = document.createElement("button");
        button.className = "b3-button b3-button--outline";
        button.textContent = "运行测试";

        const status = document.createElement("span");
        status.style.cssText =
          "font-size:12px;color:var(--b3-theme-on-surface-light);word-break:break-all;max-width:380px";
        status.textContent = "未运行";

        button.addEventListener("click", () => {
          // NOTE: B11 — 直接读输入框当前值，避免必须先点保存才能测试新填的路径。
          const liveRepoRoot = inputs.repoRoot?.value.trim() || this.config.repoRoot;
          const liveBinary = inputs.gitBinary?.value.trim() ?? this.config.gitBinary;
          status.textContent = "运行中…";
          status.style.color = "var(--b3-theme-primary)";
          void this.testGitConnection(liveRepoRoot, liveBinary).then((res) => {
            status.textContent = res.message;
            status.style.color = res.ok
              ? "var(--b3-card-success-color, #2ca02c)"
              : "var(--b3-card-error-color, #d33)";
          });
        });

        wrapper.appendChild(button);
        wrapper.appendChild(status);
        return wrapper;
      },
    });

    safeAddItem({
      title: "Git 可执行路径",
      description:
        "留空则自动从 PATH 探测；如插件提示找不到 git，可填写绝对路径，例如 C:/Program Files/Git/cmd/git.exe。",
      build: () => {
        inputs.gitBinary = createTextInput(this.config.gitBinary);
        return inputs.gitBinary;
      },
    });

    safeAddItem({
      title: "Git 远端",
      description: "默认 origin。如果你的远端别名不同可以改这里。",
      build: () => {
        inputs.gitRemote = createTextInput(this.config.gitRemote);
        return inputs.gitRemote;
      },
    });

    safeAddItem({
      title: "Git 分支",
      description: "默认 main。GitHub Actions 监听该分支并自动构建部署。",
      build: () => {
        inputs.gitBranch = createTextInput(this.config.gitBranch);
        return inputs.gitBranch;
      },
    });

    safeAddItem({
      title: "提交消息模板",
      description: "支持占位符：{slug} {title} {date}。例如 post: {slug} 或 post({slug}): {title}。",
      build: () => {
        inputs.commitMessage = createTextInput(this.config.commitMessageTemplate);
        return inputs.commitMessage;
      },
    });

    safeAddItem({
      title: "推送前 pull --rebase",
      description: "默认关闭；多端写文章时建议打开以减少 push 冲突。",
      build: () => {
        inputs.pullBeforePush = createCheckbox(this.config.pullBeforePush);
        return inputs.pullBeforePush;
      },
    });

    // ------ 五、站点发布（一键到公开 Pages 仓库） ------
    sectionHeader(
      "【五】站点发布（一键到公开 Pages 仓库）",
      "可选；启用后导出并推送会自动跑 hugo build → pagefind → 强推 public/ 到公开仓库",
    );
    safeAddItem({
      title: "启用一键发布",
      description:
        "开启后「导出并推送」流程末尾会自动构建并发布到下方 publishRepoUrl。关闭则只推源码到私有仓库。",
      build: () => {
        inputs.autoPublishEnabled = createCheckbox(this.config.autoPublishEnabled);
        return inputs.autoPublishEnabled;
      },
    });

    safeAddItem({
      title: "Hugo 可执行路径",
      description: "留空则自动从 PATH 探测；如本机 hugo 不在 PATH，可填绝对路径，例如 I:/SoftWare/hugo/hugo.exe。",
      build: () => {
        inputs.hugoBinary = createTextInput(this.config.hugoBinary);
        return inputs.hugoBinary;
      },
    });

    safeAddItem({
      title: "Hugo build 参数",
      description: "每行一个参数。默认 --gc / --minify / --enableGitInfo=false（避免缺 git 时 hugo 崩）。",
      build: () => {
        inputs.hugoArgs = createMultilineInput(stringifyOptions(this.config.hugoArgs), 4);
        return inputs.hugoArgs;
      },
    });

    safeAddItem({
      title: "构建 Pagefind 索引",
      description: "开启后 hugo build 完成会用 pagefind 在 public/ 上构建全文搜索索引。",
      build: () => {
        inputs.pagefindEnabled = createCheckbox(this.config.pagefindEnabled);
        return inputs.pagefindEnabled;
      },
    });

    safeAddItem({
      title: "Pagefind 可执行路径",
      description:
        "留空则尝试 <repo>/node_modules/@pagefind/<platform>/bin/pagefind_extended.exe，再回退 PATH。",
      build: () => {
        inputs.pagefindBinary = createTextInput(this.config.pagefindBinary);
        return inputs.pagefindBinary;
      },
    });

    safeAddItem({
      title: "公开仓库 URL",
      description:
        "GitHub Pages 公开仓库的 https 地址，例如 https://github.com/<owner>/<owner>.github.io.git。仅支持 https://github.com/。",
      build: () => {
        inputs.publishRepoUrl = createTextInput(this.config.publishRepoUrl);
        return inputs.publishRepoUrl;
      },
    });

    safeAddItem({
      title: "公开仓库分支",
      description: "默认 main。每次发布会强推（force）覆盖该分支。",
      build: () => {
        inputs.publishBranch = createTextInput(this.config.publishBranch);
        return inputs.publishBranch;
      },
    });

    safeAddItem({
      title: "自定义域名（CNAME）",
      description: "可空。若用了自定义域名（例如 lpppp.xyz），填进来，每次发布都会写入 public/CNAME 保留绑定。",
      build: () => {
        inputs.publishCNAME = createTextInput(this.config.publishCNAME);
        return inputs.publishCNAME;
      },
    });

    // ------ 六、维护操作 ------
    sectionHeader("【六】维护", "重置配置等不常用操作");
    safeAddItem({
      title: "加载示例候选项",
      description: "把通用示例（如 技术 / 随笔 / 教程 等）合并到 categories/tags 候选中，初次安装快速上手。已存在的不重复添加。",
      build: () => {
        const button = document.createElement("button");
        button.className = "b3-button b3-button--outline";
        button.textContent = "加载示例";
        button.addEventListener("click", () => {
          const merged = mergePluginConfig({
            ...this.config,
            categoryOptions: this.unionStrings(this.config.categoryOptions, EXAMPLE_CATEGORY_OPTIONS),
            tagOptions: this.unionStrings(this.config.tagOptions, EXAMPLE_TAG_OPTIONS),
            collectionOptions: this.unionStrings(this.config.collectionOptions, EXAMPLE_COLLECTION_OPTIONS),
          });
          this.config = merged;
          // NOTE: 同步到设置页 textarea；魔尊点保存时才落盘，避免误操作。
          if (inputs.categoryOptions) inputs.categoryOptions.value = stringifyOptions(merged.categoryOptions);
          if (inputs.tagOptions) inputs.tagOptions.value = stringifyOptions(merged.tagOptions);
          if (inputs.collectionOptions) inputs.collectionOptions.value = stringifyOptions(merged.collectionOptions);
          showMessage("已加载示例候选项；点底部「保存」生效");
        });
        return button;
      },
    });

    safeAddItem({
      title: "清理表单缓存",
      description: `自动 LRU 淘汰策略：超过 ${LASTFORM_TTL_DAYS} 天未访问 / 超过 ${LASTFORM_LIMIT} 条都会自动清理。手动按钮可立刻全部清空。`,
      build: () => {
        const wrapper = document.createElement("div");
        wrapper.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap";

        const status = document.createElement("span");
        status.style.cssText =
          "font-size:12px;color:var(--b3-theme-on-surface-light);word-break:break-all;max-width:380px";
        const updateStatus = (): void => {
          const count = Object.keys(this.lastForms).length;
          if (count === 0) {
            status.textContent = "当前缓存为空";
          } else {
            const bytes = estimateLastFormsBytes(this.lastForms);
            const sizeText = bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
            status.textContent = `已记忆 ${count} 篇文档，约 ${sizeText}`;
          }
        };
        updateStatus();

        const clearButton = document.createElement("button");
        clearButton.className = "b3-button b3-button--outline";
        clearButton.textContent = "清空全部";
        clearButton.addEventListener("click", () => {
          const count = Object.keys(this.lastForms).length;
          if (count === 0) {
            showMessage("缓存已经是空的");
            return;
          }
          confirm(
            "清理表单缓存",
            `确定清空 ${count} 篇文档的字段记忆？\n\n` +
              "• 之后再导出这些文档时不会再自动预填上次填过的字段；\n" +
              "• 已发布的远端文章不受影响；\n" +
              "• 候选项白名单（categories / tags / collections）保留不动。",
            () => {
              this.lastForms = {};
              this.saveData(STORAGE_LAST_FORM, this.lastForms).then(
                () => {
                  updateStatus();
                  showMessage("表单缓存已清空");
                },
                (error) => {
                  console.error("[hugo-exporter] clear last-form failed", error);
                  showMessage(`清理失败：${this.formatError(error)}`);
                },
              );
            },
          );
        });

        wrapper.appendChild(clearButton);
        wrapper.appendChild(status);
        return wrapper;
      },
    });

    safeAddItem({
      title: "重置为默认配置",
      description: "把所有配置（含候选项、Git 设置）恢复成插件出厂默认值；操作前会要求确认。",
      build: () => {
        const button = document.createElement("button");
        button.className = "b3-button b3-button--outline";
        button.textContent = "重置";
        button.addEventListener("click", () => {
          confirm(
            "重置 Hugo Exporter 配置",
            "将把所有设置恢复为出厂默认值（你保存过的仓库路径、候选项、Git 配置全部丢失）。是否继续？",
            () => {
              this.config = { ...DEFAULT_PLUGIN_CONFIG };
              this.saveData(STORAGE_NAME, this.config).then(
                () => {
                  showMessage("已重置为默认配置；请关闭并重新打开设置页查看新值");
                },
                (error) => {
                  console.error("[hugo-exporter] reset saveData failed", error);
                  showMessage(`重置失败：${this.formatError(error)}`);
                },
              );
            },
          );
        });
        return button;
      },
    });
  }

  /**
   * runExport 执行当前文档导出，并按需把 leaf bundle commit + push 到 GitHub。
   * NOTE: 弹窗按钮决定流程：
   *  - 预览导出  → 只生成 manifest，不写入；
   *  - 导出并写入 → 写 index.md + 复制资源；
   *  - 导出并推送 → 在写入完成后调用 git adapter，提交并 push 远端。
   *
   * 进度反馈：非 dry-run 流程使用进度对话框逐步显示，避免 toast 一闪而过。
   */
  private async runExport(): Promise<void> {
    let progress: ProgressDialog | null = null;
    let stage: "snapshot" | "editor" | "plan" | "write" | "assets" | "git" = "snapshot";
    let stagePath = "";

    // NOTE: 在抓快照之前先做轻量校验：思源里没有打开文档时直接给友好提示，
    //       不走整个 stage=snapshot 错误链路（避免出现 "Hugo 导出异常（snapshot）：..." 这种唬人栈）。
    if (!hasActiveDocument()) {
      showMessage("请先在思源里打开一篇文档（点击文档树里的笔记），再点「导出当前文档」。");
      return;
    }

    try {
      stage = "snapshot";
      const doc = await readCurrentDocumentSnapshot();

      stage = "editor";
      // NOTE: B6 — 把上次填过的字段值（按 docId）传给编辑器作为初始值。
      //       v0.2.4 起 lastForms 是 {fields, lastAccessedAt} 结构，这里取 fields；
      //       同时刷新 lastAccessedAt 以保护活跃文档不被 LRU 淘汰。
      const lastRecord = this.lastForms[doc.id];
      const lastValues = lastRecord?.fields;
      if (lastRecord) {
        this.lastForms = {
          ...this.lastForms,
          [doc.id]: { fields: lastRecord.fields, lastAccessedAt: new Date().toISOString() },
        };
      }
      const outcome = await openFrontmatterEditor(doc, this.config.dryRunDefault, this.config.defaultFrontmatterYaml, {
        repoRoot: this.config.repoRoot,
        contentDir: this.config.contentDir,
        categoryOptions: this.config.categoryOptions,
        tagOptions: this.config.tagOptions,
        collectionOptions: this.config.collectionOptions,
        gitEnabled: this.config.gitEnabled,
        gitRemote: this.config.gitRemote,
        gitBranch: this.config.gitBranch,
        lastValues,
        // NOTE: 用户在弹窗里临时新增的候选项，立即合并到 config 并 saveData，
        //       下次开任意文档都能在 chip 列表里看到。
        onAddOption: (key, added) => void this.persistOptionAdditions(key, added),
        // NOTE: 重命名候选项：替换 config 候选库里的同名项；
        //       同时把 lastForms 里所有 docId 下引用 oldName 的对应字段值也替换，避免下次预填出现"幽灵旧值"。
        onRenameOption: (key, oldName, newName) =>
          void this.persistOptionRename(key, oldName, newName),
        // NOTE: 删除候选项：从 config 候选库里移除；
        //       lastForms 里的"已选中此值"也一并清掉，避免下次预填又出现一个已被删除的标签。
        onDeleteOption: (key, name) => void this.persistOptionDelete(key, name),
      });
      if (!outcome) {
        // NOTE: 用户取消，不视为错误，也不弹失败提示。
        return;
      }

      stage = "plan";
      const result = exportHugoPost({
        doc,
        repoRoot: this.config.repoRoot,
        contentDir: this.config.contentDir,
        assetSubDir: this.config.assetSubDir,
        assetBasePath: this.config.assetBasePath || this.config.repoRoot,
        dryRun: outcome.dryRun,
        now: new Date().toISOString(),
        slug: outcome.slug,
        frontmatterOverride: outcome.frontmatter,
      });
      stagePath = result.manifest.target;

      if (!result.ok || !result.content) {
        showMessage(`Hugo 导出失败：${result.errors.join("; ")}`);
        return;
      }

      console.log("[hugo-exporter] export plan", {
        repoRoot: this.config.repoRoot,
        target: result.manifest.target,
        plannedWrites: result.manifest.plannedWrites,
        dryRun: outcome.dryRun,
        push: outcome.push,
      });

      if (outcome.dryRun) {
        showMessage(
          `Hugo dry-run：将写入 ${result.manifest.target}；计划 ${result.manifest.plannedWrites.length} 个文件，资源 ${result.assetPlans.length} 个`,
        );
        return;
      }

      // NOTE: D5 — 写入前若 index.md 已存在，先确认是否覆盖（仅在非 dry-run 时检查）。
      const indexAbsolute = await this.resolveAbsolutePath(this.config.repoRoot, result.manifest.target);
      if (await this.fileExists(indexAbsolute)) {
        const proceed = await this.askOverwrite(result.manifest.target, indexAbsolute);
        if (!proceed) {
          showMessage("已取消导出（目标 index.md 已存在）");
          return;
        }
      }

      progress = openProgressDialog(outcome.push ? "Hugo 导出并推送" : "Hugo 导出");
      progress.addStep({ id: "write", label: "写入 index.md" });
      progress.addStep({ id: "assets", label: `复制资源（${result.assetPlans.length} 个）` });
      if (outcome.push) {
        progress.addStep({ id: "git-binary", label: "解析 git 路径" });
        progress.addStep({ id: "git-verify", label: "验证仓库（rev-parse）" });
        if (this.config.pullBeforePush) {
          progress.addStep({ id: "git-pull", label: `pull --rebase ${this.config.gitRemote}/${this.config.gitBranch}` });
        }
        progress.addStep({ id: "git-status", label: "git status（检测变更）" });
        progress.addStep({ id: "git-add", label: "git add 本次 bundle" });
        progress.addStep({ id: "git-commit", label: "git commit" });
        progress.addStep({ id: "git-push", label: `git push ${this.config.gitRemote}/${this.config.gitBranch}` });
      }

      // NOTE: 站点发布阶段（v0.3.0）— 仅在魔尊点了「导出并推送」且开启 autoPublishEnabled 时执行。
      //       一次性把 hugo build / pagefind / 推 public 三步注册到进度对话框。
      const willPublish = !!(outcome.push && this.config.autoPublishEnabled && this.config.publishRepoUrl);
      if (willPublish) {
        progress.addStep({ id: "publish-build", label: "本地 hugo build" });
        if (this.config.pagefindEnabled) {
          progress.addStep({ id: "publish-pagefind", label: "构建 pagefind 索引" });
        }
        progress.addStep({ id: "publish-push", label: `推 public/ 到 ${this.config.publishRepoUrl}` });
      }

      stage = "write";
      stagePath = result.manifest.target;
      progress.update("write", "running", result.manifest.target);
      const written = await writeExportedIndex({
        repoRoot: this.config.repoRoot,
        relativeIndexPath: result.manifest.target,
        content: result.content,
        dryRun: false,
      });
      progress.update("write", "ok", written.absolutePath);

      stage = "assets";
      stagePath = `${result.assetPlans.length} 个资源`;
      progress.update("assets", "running", `0 / ${result.assetPlans.length}`);
      const assetCopy = await copyExportedAssets({
        repoRoot: this.config.repoRoot,
        dryRun: false,
        assetPlans: result.assetPlans,
        assetBasePath: this.config.assetBasePath || this.config.repoRoot,
        concurrency: 8,
        onProgress: (done, total) => {
          progress?.update("assets", "running", `${done} / ${total}`);
        },
      });
      const assetSummary =
        assetCopy.warnings.length > 0
          ? `复制 ${assetCopy.copied.length}，警告 ${assetCopy.warnings.length}`
          : `复制 ${assetCopy.copied.length}`;
      progress.update("assets", assetCopy.warnings.length > 0 ? "warn" : "ok", assetSummary);
      for (const warn of assetCopy.warnings) {
        progress.appendLog(`[asset] ${warn}`);
      }

      const summary = `Hugo 导出完成：${written.absolutePath}；资源 ${assetCopy.copied.length} 个`;
      showMessage(summary);

      // NOTE: B6 — 写入成功后把本次字段缓存起来，下次开同一文档自动预填。
      void this.rememberLastForm(doc.id, outcome.frontmatter);

      if (!outcome.push) {
        progress.finalize(true, summary);
        return;
      }

      stage = "git";
      stagePath = `${this.config.gitRemote}/${this.config.gitBranch}`;
      const pushParams = {
        slug: outcome.slug,
        title: doc.title,
        bundleRelativeDir: dirnameRelative(result.manifest.target),
      };
      const pushSummary = await this.runGitPush(progress, pushParams);
      if (!pushSummary.ok) {
        progress.finalize(false, pushSummary.text);
        // NOTE: B2 — 失败时给一个"仅重试推送"按钮，魔尊修好凭据/网络后一键再试。
        const retry = async (): Promise<void> => {
          if (!progress) return;
          progress.setActionButton(null);
          progress.update("git-verify", "pending", "");
          progress.update("git-status", "pending", "");
          progress.update("git-add", "pending", "");
          progress.update("git-commit", "pending", "");
          progress.update("git-push", "pending", "");
          if (this.config.pullBeforePush) progress.update("git-pull", "pending", "");
          const retrySummary = await this.runGitPush(progress, pushParams);
          progress.finalize(retrySummary.ok, retrySummary.text);
          if (!retrySummary.ok) {
            progress.setActionButton({ label: "仅重试推送", onClick: () => void retry() });
          }
        };
        progress.setActionButton({ label: "仅重试推送", onClick: () => void retry() });
        return;
      }

      // 推源码成功后，按需做"一键发布"：本地 hugo build → pagefind → 推 public/。
      if (!willPublish) {
        progress.finalize(true, pushSummary.text);
        return;
      }

      stage = "git";
      stagePath = "publish";
      const publishOk = await this.runPublishPipeline(progress);
      if (publishOk.ok) {
        progress.finalize(true, `${pushSummary.text}；${publishOk.text}`);
      } else {
        progress.finalize(false, `源码已 push，但站点发布失败：${publishOk.text}`);
        // 站点发布失败时给个"仅重试发布"按钮，避免重写文章。
        const retryPublish = async (): Promise<void> => {
          if (!progress) return;
          progress.setActionButton(null);
          progress.update("publish-build", "pending", "");
          if (this.config.pagefindEnabled) progress.update("publish-pagefind", "pending", "");
          progress.update("publish-push", "pending", "");
          const retry = await this.runPublishPipeline(progress);
          progress.finalize(retry.ok, retry.ok ? `${pushSummary.text}；${retry.text}` : `源码已 push，但站点发布失败：${retry.text}`);
          if (!retry.ok) {
            progress.setActionButton({ label: "仅重试发布", onClick: () => void retryPublish() });
          }
        };
        progress.setActionButton({ label: "仅重试发布", onClick: () => void retryPublish() });
      }
    } catch (error) {
      // NOTE: NoActiveDocumentError 是业务级"未开文档"错误，给极简友好提示，不进度对话框。
      if (error instanceof NoActiveDocumentError) {
        showMessage(error.message);
        return;
      }
      const message = error instanceof Error ? error.message : "未知错误";
      // NOTE: B3 — 错误信息附加阶段与路径，避免魔尊看不到具体哪个文件失败。
      const stageLabel: Record<typeof stage, string> = {
        snapshot: "读取思源文档",
        editor: "打开导出编辑器",
        plan: "生成导出计划",
        write: "写入 index.md",
        assets: "复制资源",
        git: "推送 Git",
      };
      const decoratedMessage = `Hugo 导出失败（${stageLabel[stage]}${stagePath ? ` · ${stagePath}` : ""}）：${message}`;
      showMessage(decoratedMessage);
      if (progress) {
        progress.appendLog(`[error ${stage}] ${stagePath ? `${stagePath} · ` : ""}${message}`);
        progress.finalize(false, decoratedMessage);
      }
    }
  }

  private async rememberLastForm(docId: string, frontmatter: Record<string, unknown>): Promise<void> {
    if (!docId) return;
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      if (key === "title" || key === "date" || key === "lastmod") continue;
      cleaned[key] = value;
    }
    // NOTE: 升级后的结构带 lastAccessedAt，便于 LRU 淘汰旧文档。
    this.lastForms = {
      ...this.lastForms,
      [docId]: { fields: cleaned, lastAccessedAt: new Date().toISOString() },
    };
    try {
      await this.saveData(STORAGE_LAST_FORM, this.lastForms);
    } catch (error) {
      console.warn("[hugo-exporter] saveData last-form failed", error);
    }
  }

  /**
   * persistOptionAdditions 把用户在弹窗里临时新增的候选项写回 config 并持久化。
   * 输入：字段 key（categories/tags/collections）、新增值数组。
   *
   * 行为：
   * - 仅追加未存在过的值，不重复；
   * - 立刻 saveData 到思源 storage，下次打开任意文档都能看到；
   * - saveData 失败时仅 console 警告，不打断主流程（用户已选中的 chip 不丢）。
   */
  private async persistOptionAdditions(
    key: "categories" | "tags" | "collections",
    added: string[],
  ): Promise<void> {
    if (added.length === 0) return;
    const fieldKey =
      key === "categories" ? "categoryOptions" : key === "tags" ? "tagOptions" : "collectionOptions";
    const current = this.config[fieldKey];
    const merged = [...current];
    let changed = false;
    for (const item of added) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      if (!merged.includes(trimmed)) {
        merged.push(trimmed);
        changed = true;
      }
    }
    if (!changed) return;
    this.config = { ...this.config, [fieldKey]: merged };
    try {
      await this.saveData(STORAGE_NAME, this.config);
      console.log(`[hugo-exporter] persisted ${added.length} new ${key}`, added);
    } catch (error) {
      console.warn(`[hugo-exporter] persist ${key} failed`, error);
    }
  }

  /** resolveAbsolutePath 简易拼接绝对路径，用于 D5 检查 index.md 是否已存在（不引入 node:path）。 */
  private async resolveAbsolutePath(repoRoot: string, relative: string): Promise<string> {
    const root = repoRoot.replaceAll("\\", "/").replace(/\/+$/g, "");
    const rel = relative.replaceAll("\\", "/").replace(/^\/+/g, "");
    return `${root}/${rel}`;
  }

  /**
   * fileExists 通过 fs/promises 探测文件是否存在；任何异常都返回 false。
   *
   * NOTE: 使用顶层 import 的 access。思源 Electron renderer 下 dynamic import("node:...")
   *       会失败（vite 把它识别为浏览器 ESM），这里走顶层的方式与 git/build adapter 一致。
   */
  private async fileExists(absolutePath: string): Promise<boolean> {
    try {
      await access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  /** askOverwrite 弹一个确认框让魔尊决定是否覆盖已存在的 index.md。 */
  private askOverwrite(_relative: string, absolute: string): Promise<boolean> {
    return new Promise((resolve) => {
      confirm(
        "目标已存在",
        `${absolute}\n\n该文件已经存在。是否覆盖？\n\n注意：images/ 目录里同名图片也会被新文件替换。`,
        () => resolve(true),
        () => resolve(false),
      );
    });
  }

  /**
   * runGitPush 把刚写入的 leaf bundle commit + push 到远端。
   * 输入：进度对话框句柄、推送参数。
   * 返回：摘要信息，由 runExport 写入对话框 finalize。
   */
  private async runGitPush(
    progress: ProgressDialog,
    input: { slug: string; title: string; bundleRelativeDir: string },
  ): Promise<{ ok: boolean; text: string }> {
    if (!this.config.gitEnabled) {
      const text = "Hugo 推送已被禁用，未执行 git 操作";
      showMessage(text);
      return { ok: false, text };
    }

    progress.update("git-binary", "running");
    const binary = await resolveGitBinary(this.config.gitBinary);
    progress.update("git-binary", "ok", binary);

    const commitMessage = renderCommitMessage(this.config.commitMessageTemplate, {
      slug: input.slug,
      title: input.title,
      date: new Date().toISOString().slice(0, 10),
    });

    const stepIdByName: Record<string, string> = {
      "verify-repo": "git-verify",
      "pull-rebase": "git-pull",
      status: "git-status",
      add: "git-add",
      commit: "git-commit",
      push: "git-push",
    };

    showMessage(`Hugo 推送中：${this.config.gitRemote}/${this.config.gitBranch} · ${commitMessage}`);
    progress.update("git-verify", "running");

    // NOTE: B4 — push 步骤 30s 超时提示。push 实际仍在跑（git push 没有可靠超时），
    //       只是把 detail 改成"已等待 30 秒，常见原因 + 排查建议"，避免魔尊以为卡死。
    const pushHintTimer = window.setTimeout(() => {
      progress.update(
        "git-push",
        "running",
        "已等待 30 秒，仍在进行中。常见原因：① 凭据管理器弹窗在后台 ② 远端不可达 ③ 大文件推送中。可在终端单独 git push 排查。",
      );
    }, 30_000);

    let pushResult;
    try {
      pushResult = await exportPushBundle({
        binary,
        repoRoot: this.config.repoRoot,
        bundleRelativeDir: input.bundleRelativeDir,
        remote: this.config.gitRemote,
        branch: this.config.gitBranch,
        commitMessage,
        pullBeforePush: this.config.pullBeforePush,
      });
    } finally {
      window.clearTimeout(pushHintTimer);
    }

    console.log("[hugo-exporter] git push steps", pushResult);

    // 把 git adapter 每一步的结果映射到进度对话框。
    let lastNonEmptyOutput = "";
    for (const step of pushResult.steps) {
      const id = stepIdByName[step.name];
      if (!id) continue;
      const tail = (step.result.stderr || step.result.stdout || "").split(/\r?\n/).filter((line) => line.trim()).slice(-1)[0] ?? "";
      if (step.result.ok) {
        progress.update(id, "ok", tail || `git ${step.name} 完成`);
      } else {
        progress.update(id, "fail", tail || `git ${step.name} 失败`);
      }
      if (tail) lastNonEmptyOutput = tail;
      if (step.result.stdout) progress.appendLog(`[git ${step.name} stdout] ${step.result.stdout.trim()}`);
      if (step.result.stderr) progress.appendLog(`[git ${step.name} stderr] ${step.result.stderr.trim()}`);
    }

    // 没有变更时 add/commit 不会执行，对应步骤标记为 ok（跳过）。
    if (pushResult.ok && !pushResult.committed) {
      progress.update("git-add", "ok", "工作区无变更，已跳过");
      progress.update("git-commit", "ok", "工作区无变更，已跳过");
    }

    if (!pushResult.ok) {
      const stage = pushResult.failedStep ?? "unknown";
      const detail = pushResult.errorMessage || lastNonEmptyOutput || "未知 git 错误";
      const localState = pushResult.committed
        ? "本地 commit 已保留，请手动 git push 或排查后重试"
        : "工作区未变更";
      const text = `Hugo 推送失败（${stage}）：${detail}；${localState}`;
      showMessage(text);
      return { ok: false, text };
    }

    if (!pushResult.committed) {
      const text = `Hugo 推送完成：工作区无新增变更，已直接 push ${this.config.gitRemote}/${this.config.gitBranch}`;
      showMessage(text);
      return { ok: true, text };
    }

    const text = `Hugo 推送完成：${this.config.gitRemote}/${this.config.gitBranch} · ${commitMessage}`;
    showMessage(text);
    return { ok: true, text };
  }

  /**
   * persistOptionRename 把候选库里 oldName → newName，并联动 lastForms 中所有 docId 的对应字段。
   * 输入：字段 key、旧值、新值。
   */
  private async persistOptionRename(
    key: "categories" | "tags" | "collections",
    oldName: string,
    newName: string,
  ): Promise<void> {
    if (!oldName || !newName || oldName === newName) return;
    const fieldKey =
      key === "categories" ? "categoryOptions" : key === "tags" ? "tagOptions" : "collectionOptions";

    const renamed: string[] = [];
    let changed = false;
    for (const item of this.config[fieldKey]) {
      if (item === oldName) {
        if (!renamed.includes(newName)) renamed.push(newName);
        changed = true;
      } else if (!renamed.includes(item)) {
        renamed.push(item);
      }
    }
    if (!changed) return;
    this.config = { ...this.config, [fieldKey]: renamed };

    // 联动更新 lastForms：每个 docId 下的同字段已选中值也要把 oldName 改成 newName。
    const updatedForms: LastFormsMap = {};
    for (const [docId, record] of Object.entries(this.lastForms)) {
      const value = record.fields[key];
      if (Array.isArray(value)) {
        const next: string[] = [];
        for (const v of value) {
          const replaced = v === oldName ? newName : v;
          if (typeof replaced === "string" && !next.includes(replaced)) next.push(replaced);
        }
        updatedForms[docId] = {
          fields: { ...record.fields, [key]: next },
          lastAccessedAt: record.lastAccessedAt,
        };
      } else {
        updatedForms[docId] = record;
      }
    }
    this.lastForms = updatedForms;

    try {
      await Promise.all([
        this.saveData(STORAGE_NAME, this.config),
        this.saveData(STORAGE_LAST_FORM, this.lastForms),
      ]);
      console.log(`[hugo-exporter] renamed ${key}: ${oldName} -> ${newName}`);
    } catch (error) {
      console.warn(`[hugo-exporter] rename ${key} persist failed`, error);
    }
  }

  /**
   * persistOptionDelete 从候选库永久删除某项；联动 lastForms 中所有 docId 的对应字段（取消该值）。
   */
  private async persistOptionDelete(
    key: "categories" | "tags" | "collections",
    name: string,
  ): Promise<void> {
    if (!name) return;
    const fieldKey =
      key === "categories" ? "categoryOptions" : key === "tags" ? "tagOptions" : "collectionOptions";
    const next = this.config[fieldKey].filter((item) => item !== name);
    if (next.length === this.config[fieldKey].length) return;
    this.config = { ...this.config, [fieldKey]: next };

    const updatedForms: LastFormsMap = {};
    for (const [docId, record] of Object.entries(this.lastForms)) {
      const value = record.fields[key];
      if (Array.isArray(value)) {
        updatedForms[docId] = {
          fields: { ...record.fields, [key]: value.filter((v) => v !== name) },
          lastAccessedAt: record.lastAccessedAt,
        };
      } else {
        updatedForms[docId] = record;
      }
    }
    this.lastForms = updatedForms;

    try {
      await Promise.all([
        this.saveData(STORAGE_NAME, this.config),
        this.saveData(STORAGE_LAST_FORM, this.lastForms),
      ]);
      console.log(`[hugo-exporter] deleted ${key}: ${name}`);
    } catch (error) {
      console.warn(`[hugo-exporter] delete ${key} persist failed`, error);
    }
  }

  /** unionStrings 合并两个字符串数组，去重去空白，保留前一个数组的顺序优先。 */
  private unionStrings(base: string[], extra: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of [...base, ...extra]) {
      const trimmed = (item ?? "").trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
    }
    return result;
  }

  /**
   * runPublishPipeline 执行"hugo build → pagefind → 推 public/"完整链路。
   * 输入：进度对话框句柄。
   * 返回：{ ok, text }；text 是单行可放 toast / finalize 的摘要。
   *
   * 安全说明：
   * - hugo binary / pagefind binary 由 build adapter 解析（不存在时已有降级）；
   * - public/ 路径恒为 <repoRoot>/public，写入前 build adapter 已校验在 repoRoot 内；
   * - publishPublicSnapshot 内部强制只接受 https://github.com/.../... 形式的 URL。
   */
  private async runPublishPipeline(progress: ProgressDialog): Promise<{ ok: boolean; text: string }> {
    const repoRoot = this.config.repoRoot;
    if (!repoRoot) {
      return { ok: false, text: "Hugo 仓库路径未配置，无法构建" };
    }

    // 1. hugo build
    progress.update("publish-build", "running");
    const hugoBinary = await resolveHugoBinary(this.config.hugoBinary);
    const buildResult = await runHugoBuild({
      binary: hugoBinary,
      repoRoot,
      args: this.config.hugoArgs,
      cleanPublicFirst: true,
    });
    const buildTail = (buildResult.stderr || buildResult.stdout || "").split(/\r?\n/).filter((l) => l.trim()).slice(-1)[0] ?? "";
    if (buildResult.stdout) progress.appendLog(`[hugo stdout] ${buildResult.stdout.trim()}`);
    if (buildResult.stderr) progress.appendLog(`[hugo stderr] ${buildResult.stderr.trim()}`);
    if (!buildResult.ok) {
      progress.update("publish-build", "fail", buildTail || "hugo build 失败");
      return { ok: false, text: `hugo build 失败：${buildTail || "见日志"}` };
    }
    progress.update("publish-build", "ok", buildTail || `hugo binary=${hugoBinary}`);

    // 2. pagefind 索引（可选）
    if (this.config.pagefindEnabled) {
      progress.update("publish-pagefind", "running");
      const pagefindBinary = await resolvePagefindBinary(this.config.pagefindBinary, repoRoot);
      const pfResult = await runPagefindIndex({ binary: pagefindBinary, repoRoot });
      const pfTail = (pfResult.stderr || pfResult.stdout || "").split(/\r?\n/).filter((l) => l.trim()).slice(-1)[0] ?? "";
      if (pfResult.stdout) progress.appendLog(`[pagefind stdout] ${pfResult.stdout.trim()}`);
      if (pfResult.stderr) progress.appendLog(`[pagefind stderr] ${pfResult.stderr.trim()}`);
      if (!pfResult.ok) {
        progress.update("publish-pagefind", "fail", pfTail || "pagefind 失败");
        return { ok: false, text: `pagefind 失败：${pfTail || "见日志"}` };
      }
      progress.update("publish-pagefind", "ok", pfTail || `pagefind binary=${pagefindBinary}`);
    }

    // 3. 把 public/ 强推到公开仓库
    progress.update("publish-push", "running");
    const gitBinary = await resolveGitBinary(this.config.gitBinary);
    const publicDir = `${repoRoot.replaceAll("\\", "/").replace(/\/+$/g, "")}/public`;
    const commitMessage = `deploy: ${new Date().toISOString().slice(0, 19).replace("T", " ")} from siyuan-plugin-hugo-exporter`;
    const publishResult = await publishPublicSnapshot({
      binary: gitBinary,
      publicDir,
      repoUrl: this.config.publishRepoUrl,
      branch: this.config.publishBranch || "main",
      commitMessage,
      cname: this.config.publishCNAME,
      addNoJekyll: true,
    });
    if (!publishResult.ok) {
      progress.update("publish-push", "fail", publishResult.errorMessage || "git push 失败");
      return {
        ok: false,
        text: `推送 public/ 失败（${publishResult.failedStep ?? "?"}）：${publishResult.errorMessage ?? ""}`,
      };
    }
    const shaShort = publishResult.commitSha ? publishResult.commitSha.slice(0, 7) : "";
    progress.update(
      "publish-push",
      "ok",
      shaShort ? `${this.config.publishRepoUrl} · ${shaShort}` : this.config.publishRepoUrl,
    );
    return {
      ok: true,
      text: `站点已发布到 ${this.config.publishRepoUrl}${shaShort ? ` · ${shaShort}` : ""}`,
    };
  }

  /**
   * testGitConnection 在设置页里验证 git 是否在仓库根可用。
   * 输入：repoRoot 与 binary（可由设置页实时输入框传入，避免必须先点保存）。
   * 返回：UI 可直接渲染的 ok 标记 + 单行 message；同时也发一条 toast 兜底。
   */
  private async testGitConnection(
    repoRootOverride?: string,
    binaryOverride?: string,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const repoRoot = (repoRootOverride ?? this.config.repoRoot).trim() || this.config.repoRoot;
      const binary = await resolveGitBinary(binaryOverride ?? this.config.gitBinary);
      const result = await verifyGitRepository(binary, repoRoot);
      if (result.ok) {
        const top = result.stdout.trim() || repoRoot;
        const message = `Git 正常：${top}（git=${binary}）`;
        showMessage(`Git 连接正常：${top}`);
        return { ok: true, message };
      }
      const detail = (result.stderr || result.stdout || "git 调用失败").split(/\r?\n/)[0];
      const message = `Git 失败：${detail}`;
      showMessage(`Git 连接失败：${detail}`);
      return { ok: false, message };
    } catch (error) {
      const message = `Git 异常：${this.formatError(error)}`;
      showMessage(message);
      return { ok: false, message };
    }
  }
}

/**
 * dirnameRelative 取相对路径的父目录，输入 content/posts/skid/index.md 返回 content/posts/skid。
 * 仅作字符串处理，避免引入 node:path 在浏览器/思源 sandbox 中的差异。
 */
function dirnameRelative(relativePath: string): string {
  const idx = relativePath.lastIndexOf("/");
  return idx >= 0 ? relativePath.slice(0, idx) : "";
}
