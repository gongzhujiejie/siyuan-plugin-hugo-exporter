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
import { Menu, Plugin, Setting, showMessage } from "siyuan";
import { copyExportedAssets, writeExportedIndex } from "./adapters/fs";
import { exportPushBundle, resolveGitBinary, verifyGitRepository } from "./adapters/git";
import { readCurrentDocumentSnapshot } from "./adapters/siyuan";
import {
  DEFAULT_PLUGIN_CONFIG,
  type HugoExporterConfig,
  mergePluginConfig,
  parseLinesToOptions,
  renderCommitMessage,
} from "./config";
import { exportHugoPost } from "./core/exportPipeline";
import { openFrontmatterEditor } from "./ui/frontmatterEditor";
import { openProgressDialog, type ProgressDialog } from "./ui/progressDialog";

const STORAGE_NAME = "hugo-exporter-config.json";

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
  private static readonly VERSION = "0.1.9";
  private config: HugoExporterConfig = DEFAULT_PLUGIN_CONFIG;

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
        });
        void this.saveData(STORAGE_NAME, this.config);
        showMessage("Hugo Exporter 配置已保存");
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

    // ------ 一、仓库与导出基础配置（最先要填的，初次安装必看） ------
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
        "立即用最近一次保存的「仓库路径 / Git 可执行路径」执行 git rev-parse --show-toplevel；先点底部『保存』再测最稳。",
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
          status.textContent = "运行中…";
          status.style.color = "var(--b3-theme-primary)";
          void this.testGitConnection().then((res) => {
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
    try {
      const doc = await readCurrentDocumentSnapshot();
      const outcome = await openFrontmatterEditor(doc, this.config.dryRunDefault, this.config.defaultFrontmatterYaml, {
        repoRoot: this.config.repoRoot,
        contentDir: this.config.contentDir,
        categoryOptions: this.config.categoryOptions,
        tagOptions: this.config.tagOptions,
        collectionOptions: this.config.collectionOptions,
        gitEnabled: this.config.gitEnabled,
        gitRemote: this.config.gitRemote,
        gitBranch: this.config.gitBranch,
      });
      if (!outcome) {
        // NOTE: 用户取消，不视为错误，也不弹失败提示。
        return;
      }

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

      progress.update("write", "running", result.manifest.target);
      const written = await writeExportedIndex({
        repoRoot: this.config.repoRoot,
        relativeIndexPath: result.manifest.target,
        content: result.content,
        dryRun: false,
      });
      progress.update("write", "ok", written.absolutePath);

      progress.update("assets", "running");
      const assetCopy = await copyExportedAssets({
        repoRoot: this.config.repoRoot,
        dryRun: false,
        assetPlans: result.assetPlans,
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

      if (!outcome.push) {
        progress.finalize(true, summary);
        return;
      }

      const pushSummary = await this.runGitPush(progress, {
        slug: outcome.slug,
        title: doc.title,
        bundleRelativeDir: dirnameRelative(result.manifest.target),
      });
      progress.finalize(pushSummary.ok, pushSummary.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      showMessage(`Hugo 导出异常：${message}`);
      if (progress) progress.finalize(false, `异常：${message}`);
    }
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

    const pushResult = await exportPushBundle({
      binary,
      repoRoot: this.config.repoRoot,
      bundleRelativeDir: input.bundleRelativeDir,
      remote: this.config.gitRemote,
      branch: this.config.gitBranch,
      commitMessage,
      pullBeforePush: this.config.pullBeforePush,
    });

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
   * testGitConnection 在设置页里验证 git 是否在仓库根可用。
   * 返回：UI 可直接渲染的 ok 标记 + 单行 message；同时也发一条 toast 兜底。
   */
  private async testGitConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const binary = await resolveGitBinary(this.config.gitBinary);
      const result = await verifyGitRepository(binary, this.config.repoRoot);
      if (result.ok) {
        const top = result.stdout.trim() || this.config.repoRoot;
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
