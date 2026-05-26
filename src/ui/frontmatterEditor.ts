/**
 * 文件用途：在思源 Dialog 中渲染 frontmatter 编辑表单。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：siyuan、js-yaml
 *
 * 安全说明：所有用户输入只用 textContent / value 写入 DOM，避免 XSS；
 * 数组字段严格 trim、去空项、去重，路径预览只做展示，真实安全校验仍交给导出核心。
 */
import { Dialog } from "siyuan";
import yaml from "js-yaml";
import { FIXIT_BLOG_PRESET } from "../presets/fixitBlog";
import type { FrontmatterFieldConfig, SiYuanDocumentSnapshot } from "../core/types";
import { buildFrontmatter } from "../core/frontmatter";
import { slugifyTitle } from "../core/slug";
import {
  buildTargetPreview,
  mergeOptionValues,
  parseArrayInput,
  parseObjectInput,
  splitFrontmatterFields,
  stringifyArray,
  stringifyObject,
  stringifyScalar,
  toggleArrayValue,
} from "./frontmatterEditor.helpers";

// NOTE: 重新对外导出 helper，保持模块对外的公共 API（其他文件已经在用）。
export {
  buildTargetPreview,
  mergeOptionValues,
  parseArrayInput,
  parseObjectInput,
  splitFrontmatterFields,
  stringifyArray,
  stringifyObject,
  stringifyScalar,
  toggleArrayValue,
};

/** FrontmatterEditorOutcome 描述编辑器对外返回的最终值。 */
export interface FrontmatterEditorOutcome {
  slug: string;
  dryRun: boolean;
  /** push 为 true 表示魔尊点的是「导出并推送」，需要在写入后执行 git commit + push。 */
  push: boolean;
  frontmatter: Record<string, unknown>;
}

/** FrontmatterEditorOptions 是导出弹窗需要的 UI 辅助配置。 */
export interface FrontmatterEditorOptions {
  /** repoRoot 用于实时展示本次导出的目标绝对路径。 */
  repoRoot: string;
  /** contentDir 用于实时展示 <contentDir>/<slug>/index.md。 */
  contentDir: string;
  /** categoryOptions 是 categories 字段的候选项。 */
  categoryOptions: string[];
  /** tagOptions 是 tags 字段的候选项。 */
  tagOptions: string[];
  /** collectionOptions 是 collections 字段的候选项。 */
  collectionOptions: string[];
  /** gitEnabled 控制是否在弹窗中渲染「导出并推送」按钮。 */
  gitEnabled: boolean;
  /** gitRemote 与 gitBranch 仅用于按钮 hover 提示，让魔尊一眼看到推送目标。 */
  gitRemote: string;
  gitBranch: string;
  /**
   * lastValues 是上一次导出本文档（按 docId）填过的字段值，覆盖 preset/YAML 默认。
   * title/date/lastmod 永远从思源文档实时取，不会被 lastValues 覆盖。
   */
  lastValues?: Record<string, unknown>;
}

interface FieldRow {
  field: FrontmatterFieldConfig;
  read(): unknown;
}

/** defaultSlug 使用核心 slugify 逻辑生成默认 leaf bundle 目录名。 */
function defaultSlug(doc: SiYuanDocumentSnapshot): string {
  return slugifyTitle(doc.title);
}

/** getFieldOptions 根据字段 key 返回对应候选项。 */
function getFieldOptions(fieldKey: string, options?: FrontmatterEditorOptions): string[] {
  if (!options) return [];
  if (fieldKey === "categories") return options.categoryOptions;
  if (fieldKey === "tags") return options.tagOptions;
  if (fieldKey === "collections") return options.collectionOptions;
  return [];
}

/** createRowShell 创建每个 frontmatter 字段共用的左右布局。 */
function createRowShell(form: HTMLElement, field: FrontmatterFieldConfig): { item: HTMLDivElement; valueBox: HTMLDivElement } {
  const item = document.createElement("div");
  item.style.cssText = "margin-bottom:12px;display:flex;align-items:flex-start;gap:12px";

  const labelBox = document.createElement("div");
  labelBox.style.cssText = "flex:0 0 130px;padding-top:6px;font-weight:500";
  labelBox.textContent = `${field.label}（${field.key}）`;

  const valueBox = document.createElement("div");
  valueBox.style.cssText = "flex:1 1 auto";

  item.appendChild(labelBox);
  item.appendChild(valueBox);
  form.appendChild(item);
  return { item, valueBox };
}

/**
 * createSelectableArrayInput 渲染 chip 多选 + 自由输入组件。
 * 适用于 categories / tags / collections：候选项由设置页维护，临时新值可直接输入并用于本次导出。
 */
function createSelectableArrayInput(valueBox: HTMLElement, initialValue: unknown, configuredOptions: string[]): () => string[] {
  let selected = parseArrayInput(stringifyArray(initialValue));
  let options = mergeOptionValues(configuredOptions, selected);
  let filterText = "";

  const chips = document.createElement("div");
  // NOTE: chip 区超过 96px 自动滚动，避免候选过多撑爆表单（B8）。
  chips.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;max-height:120px;overflow:auto;padding:2px";

  // NOTE: 候选过多时，提供一个搜索输入框做实时过滤；少时不显示，保持界面简洁。
  const filterInput = document.createElement("input");
  filterInput.type = "text";
  filterInput.className = "b3-text-field fn__block";
  filterInput.placeholder = "在候选中过滤…";
  filterInput.style.cssText = "margin-bottom:6px;font-size:12px";
  filterInput.addEventListener("input", () => {
    filterText = filterInput.value.trim().toLowerCase();
    renderChips();
  });

  const inputRow = document.createElement("div");
  inputRow.style.cssText = "display:flex;gap:6px";

  const customInput = document.createElement("input");
  customInput.type = "text";
  customInput.className = "b3-text-field fn__block";
  customInput.placeholder = "新建：回车 / 点 + / 用逗号一次输多个";

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "b3-button b3-button--outline";
  addButton.textContent = "+";
  addButton.title = "新增到本次已选项";

  inputRow.appendChild(customInput);
  inputRow.appendChild(addButton);
  if (configuredOptions.length > 12 || options.length > 12) {
    valueBox.appendChild(filterInput);
  }
  valueBox.appendChild(chips);
  valueBox.appendChild(inputRow);

  const renderChips = (): void => {
    chips.textContent = "";
    if (options.length === 0) {
      const empty = document.createElement("span");
      empty.style.cssText = "color:var(--b3-theme-on-surface-light);font-size:12px";
      empty.textContent = "暂无候选项，可在下方输入，或到插件设置里维护候选列表。";
      chips.appendChild(empty);
      return;
    }

    const visible = filterText
      ? options.filter((option) => option.toLowerCase().includes(filterText))
      : options;

    if (visible.length === 0) {
      const empty = document.createElement("span");
      empty.style.cssText = "color:var(--b3-theme-on-surface-light);font-size:12px";
      empty.textContent = `没有匹配 "${filterText}" 的候选；可点 + 直接新增。`;
      chips.appendChild(empty);
      return;
    }

    for (const option of visible) {
      const active = selected.includes(option);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = active ? "b3-button b3-button--text" : "b3-button b3-button--outline";
      chip.style.cssText = "padding:2px 8px;font-size:12px";
      chip.textContent = active ? `${option} ✓` : option;
      chip.addEventListener("click", () => {
        selected = toggleArrayValue(selected, option);
        renderChips();
      });
      chips.appendChild(chip);
    }
  };

  const addCustomValue = (): void => {
    const additions = parseArrayInput(customInput.value);
    if (additions.length === 0) return;
    for (const item of additions) {
      if (!options.includes(item)) options = [...options, item];
      if (!selected.includes(item)) selected = [...selected, item];
    }
    customInput.value = "";
    renderChips();
  };

  addButton.addEventListener("click", addCustomValue);
  customInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addCustomValue();
  });

  renderChips();
  return () => selected;
}

/** createFieldRow 根据字段类型渲染编辑控件并返回读取函数。 */
function createFieldRow(
  form: HTMLElement,
  field: FrontmatterFieldConfig,
  initialValue: unknown,
  options?: FrontmatterEditorOptions,
): FieldRow {
  const { valueBox } = createRowShell(form, field);
  let read: () => unknown;

  if (field.type === "boolean") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "b3-switch fn__flex-center";
    input.checked = initialValue === true;
    valueBox.appendChild(input);
    read = () => input.checked;
  } else if (field.type === "array") {
    const configuredOptions = getFieldOptions(field.key, options);
    if (["categories", "tags", "collections"].includes(field.key)) {
      read = createSelectableArrayInput(valueBox, initialValue, configuredOptions);
    } else {
      const textarea = document.createElement("textarea");
      textarea.className = "b3-text-field fn__block";
      textarea.rows = 2;
      textarea.placeholder = "每行一项，或英文逗号分隔";
      textarea.value = stringifyArray(initialValue);
      valueBox.appendChild(textarea);
      read = () => parseArrayInput(textarea.value);
    }
  } else if (field.type === "object") {
    const textarea = document.createElement("textarea");
    textarea.className = "b3-text-field fn__block";
    textarea.rows = 4;
    textarea.placeholder = '{ "enable": true, "auto": true }';
    textarea.value = stringifyObject(initialValue);
    valueBox.appendChild(textarea);
    read = () => parseObjectInput(textarea.value);
  } else {
    const isLong = field.key === "description" || field.key === "summary";
    const input = isLong ? document.createElement("textarea") : document.createElement("input");
    if (input instanceof HTMLTextAreaElement) {
      // NOTE: B10 — 长文本字段默认 4 行，并允许垂直手动拉大；不影响其他字段。
      input.rows = 4;
      input.style.resize = "vertical";
    } else {
      input.type = field.key === "password" ? "password" : "text";
    }
    input.className = "b3-text-field fn__block";
    input.value = stringifyScalar(initialValue);
    valueBox.appendChild(input);
    read = () => (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.value.trim() : "");
  }

  return { field, read };
}

/** createSection 创建普通字段区或 details 高级字段区。 */
function createSection(root: HTMLElement, title: string, collapsed: boolean): HTMLElement {
  if (!collapsed) {
    const heading = document.createElement("div");
    heading.style.cssText = "font-weight:600;margin:2px 0 4px";
    heading.textContent = title;
    root.appendChild(heading);
    const section = document.createElement("div");
    root.appendChild(section);
    return section;
  }

  const details = document.createElement("details");
  details.style.cssText = "border-top:1px solid var(--b3-border-color);padding-top:8px";
  const summary = document.createElement("summary");
  summary.style.cssText = "cursor:pointer;font-weight:600;margin-bottom:8px";
  summary.textContent = title;
  details.appendChild(summary);
  root.appendChild(details);
  return details;
}

/**
 * openFrontmatterEditor 打开导出确认弹窗。
 * defaultDryRun 控制首次打开时 dry-run 开关状态；最终值以弹窗内开关为准。
 */
export function openFrontmatterEditor(
  doc: SiYuanDocumentSnapshot,
  defaultDryRun: boolean,
  defaultsYaml?: string,
  editorOptions?: FrontmatterEditorOptions,
): Promise<FrontmatterEditorOutcome | null> {
  return new Promise((resolve) => {
    // NOTE: 优先用配置里保存的 YAML 默认 frontmatter；解析失败时回退到 preset 默认。
    let initial = buildFrontmatter(doc, FIXIT_BLOG_PRESET);
    if (defaultsYaml && defaultsYaml.trim()) {
      try {
        const parsed = yaml.load(defaultsYaml);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          initial = { ...initial, ...(parsed as Record<string, unknown>) };
        }
      } catch (error) {
        console.warn("[hugo-exporter] parse defaultFrontmatterYaml failed", error);
      }
    }

    // NOTE: B6 — 上次导出该文档时填过的字段优先级最高（覆盖 preset / YAML 默认），
    //       但 title / date / lastmod 永远从思源文档实时取。
    if (editorOptions?.lastValues) {
      initial = { ...initial, ...editorOptions.lastValues };
    }
    initial.title = doc.title;
    initial.date = doc.createdAt;
    initial.lastmod = doc.updatedAt;

    const fieldGroups = splitFrontmatterFields(FIXIT_BLOG_PRESET.frontmatterFields);
    let resolved = false;
    const finish = (value: FrontmatterEditorOutcome | null): void => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    // NOTE: 整体布局拆成"可滚内容 scroll + 不滚按钮 buttonBar"两层，避免 B1：按钮被滚出视野。
    const root = document.createElement("div");
    root.style.cssText = "display:flex;flex-direction:column;max-height:78vh";

    const scroll = document.createElement("div");
    scroll.style.cssText = "padding:16px 18px 12px;display:flex;flex-direction:column;gap:8px;overflow:auto;flex:1 1 auto";
    root.appendChild(scroll);

    const slugRow = document.createElement("div");
    slugRow.style.cssText = "margin-bottom:4px;display:flex;align-items:center;gap:12px";
    const slugLabel = document.createElement("div");
    slugLabel.style.cssText = "flex:0 0 130px;font-weight:500";
    slugLabel.textContent = "Slug（目录名）";
    const slugInput = document.createElement("input");
    slugInput.type = "text";
    slugInput.className = "b3-text-field fn__block";
    slugInput.value = defaultSlug(doc);
    slugInput.placeholder = "content/posts/<slug>/";
    slugInput.style.cssText = "flex:1 1 auto";
    slugRow.appendChild(slugLabel);
    slugRow.appendChild(slugInput);
    scroll.appendChild(slugRow);

    const targetPreview = document.createElement("div");
    targetPreview.style.cssText =
      "padding:6px 8px;border-radius:6px;background:var(--b3-theme-surface);font-size:12px;color:var(--b3-theme-on-surface);word-break:break-all";
    scroll.appendChild(targetPreview);

    const dryRunRow = document.createElement("label");
    dryRunRow.style.cssText = "margin-bottom:8px;display:flex;align-items:center;gap:12px;cursor:pointer";
    const dryRunLabel = document.createElement("div");
    dryRunLabel.style.cssText = "flex:0 0 130px;font-weight:500";
    dryRunLabel.textContent = "仅预览";
    const dryRunInput = document.createElement("input");
    dryRunInput.type = "checkbox";
    dryRunInput.className = "b3-switch fn__flex-center";
    dryRunInput.checked = defaultDryRun;
    const dryRunHint = document.createElement("span");
    dryRunHint.style.cssText = "color:var(--b3-theme-on-surface-light);font-size:12px";
    dryRunHint.textContent = "dry-run，不写入文件";
    dryRunRow.appendChild(dryRunLabel);
    dryRunRow.appendChild(dryRunInput);
    dryRunRow.appendChild(dryRunHint);
    scroll.appendChild(dryRunRow);

    const commonSection = createSection(scroll, "常用字段", false);
    const commonRows = fieldGroups.common.map((field) =>
      createFieldRow(commonSection, field, initial[field.key], editorOptions),
    );

    const advancedSection = createSection(scroll, "高级字段", true);
    const advancedRows = fieldGroups.advanced.map((field) =>
      createFieldRow(advancedSection, field, initial[field.key], editorOptions),
    );
    const fieldRows: FieldRow[] = [...commonRows, ...advancedRows];

    // NOTE: B7 — 三个按钮说明默认折叠成 details，老用户不被打扰；新用户点开仍能看到。
    const buttonsHelp = document.createElement("details");
    buttonsHelp.style.cssText =
      "padding:6px 10px;border-radius:6px;background:var(--b3-theme-surface);font-size:12px;color:var(--b3-theme-on-surface-light);line-height:1.6";
    const buttonsHelpSummary = document.createElement("summary");
    buttonsHelpSummary.style.cssText = "cursor:pointer;font-weight:600;color:var(--b3-theme-on-surface)";
    buttonsHelpSummary.textContent = "三个按钮怎么选？";
    const buttonsHelpBody = document.createElement("div");
    buttonsHelpBody.style.cssText = "margin-top:4px";
    const helpLines = [
      "• 取消：放弃本次操作，不写入任何文件。",
      "• 预览导出（勾选「仅预览」时显示）：只生成路径与资源计划，不写文件、不推送，用于核对。",
      "• 导出并写入（取消勾选「仅预览」时显示）：写 index.md 和 images，仅写本地，不推送。",
      editorOptions?.gitEnabled
        ? "• 导出并推送（取消勾选「仅预览」且启用 Git 推送时显示）：写本地后自动 git add → commit → push，触发 GitHub Actions 部署。"
        : "• 导出并推送：当前在设置里被关闭，开启「启用 Git 推送」后会出现。",
      "",
      "快捷键：Ctrl+Enter 提交（写入或预览），Ctrl+Shift+Enter 推送，Esc 取消。",
    ];
    for (const line of helpLines) {
      const node = document.createElement("div");
      node.textContent = line;
      buttonsHelpBody.appendChild(node);
    }
    buttonsHelp.appendChild(buttonsHelpSummary);
    buttonsHelp.appendChild(buttonsHelpBody);
    scroll.appendChild(buttonsHelp);

    // NOTE: B1 — 按钮栏放在 root 末尾，紧贴 dialog 底部不滚动；与 scroll 区有 1px 上边线分割。
    const buttonBar = document.createElement("div");
    buttonBar.style.cssText =
      "display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;border-top:1px solid var(--b3-border-color);background:var(--b3-theme-background);flex:0 0 auto";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "b3-button b3-button--cancel";
    cancelBtn.textContent = "取消";
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "b3-button b3-button--text";
    const pushBtn = document.createElement("button");
    pushBtn.className = "b3-button b3-button--text";
    pushBtn.textContent = "导出并推送";
    if (editorOptions?.gitEnabled) {
      pushBtn.title = `推送到 ${editorOptions.gitRemote}/${editorOptions.gitBranch} · 快捷键 Ctrl+Shift+Enter`;
    }
    confirmBtn.title = "Ctrl+Enter";
    buttonBar.appendChild(cancelBtn);
    buttonBar.appendChild(confirmBtn);
    if (editorOptions?.gitEnabled) {
      buttonBar.appendChild(pushBtn);
    }
    root.appendChild(buttonBar);

    const refreshDynamicText = (): void => {
      confirmBtn.textContent = dryRunInput.checked ? "预览导出" : "导出并写入";
      // NOTE: dry-run 模式下隐藏推送按钮，避免推空内容；非 dry-run 且启用 git 时才出现。
      pushBtn.style.display = !dryRunInput.checked && editorOptions?.gitEnabled ? "" : "none";
      if (editorOptions) {
        targetPreview.textContent = `将写入：${buildTargetPreview(
          editorOptions.repoRoot,
          editorOptions.contentDir,
          slugInput.value,
          FIXIT_BLOG_PRESET.bundleIndexName,
        )}`;
      } else {
        targetPreview.textContent = `目标目录：${slugifyTitle(slugInput.value)}`;
      }
    };

    slugInput.addEventListener("input", refreshDynamicText);
    dryRunInput.addEventListener("change", refreshDynamicText);
    refreshDynamicText();

    const dialog = new Dialog({
      title: `Hugo 导出：${doc.title}`,
      content: '<div id="hugo-frontmatter-editor"></div>',
      width: "720px",
      height: "auto",
      destroyCallback: () => {
        // NOTE: 用户点 X 关闭时也走 finish(null)，避免 Promise 永远悬挂。
        finish(null);
      },
    });

    const mountPoint = dialog.element.querySelector("#hugo-frontmatter-editor");
    if (mountPoint) {
      mountPoint.appendChild(root);
    }

    cancelBtn.addEventListener("click", () => {
      dialog.destroy();
    });

    const submit = (push: boolean): void => {
      try {
        const frontmatter: Record<string, unknown> = {};
        for (const row of fieldRows) {
          const value = row.read();
          const isEmptyArray = Array.isArray(value) && value.length === 0 && !row.field.required;
          if (value === undefined || value === "" || isEmptyArray) {
            continue;
          }
          frontmatter[row.field.key] = value;
        }

        const slug = slugInput.value.trim();
        if (!slug) {
          alert("Slug 不能为空");
          return;
        }

        // NOTE: dry-run 与 push 互斥：dry-run 不写文件，push 一定要先写文件。
        const dryRun = dryRunInput.checked;
        finish({
          slug,
          dryRun: push ? false : dryRun,
          push: push && !dryRun,
          frontmatter,
        });
        dialog.destroy();
      } catch (error) {
        alert(error instanceof Error ? error.message : "字段解析失败");
      }
    };

    confirmBtn.addEventListener("click", () => submit(false));
    pushBtn.addEventListener("click", () => submit(true));

    // NOTE: B9 — 键盘快捷键。Ctrl/Cmd+Enter 提交（按当前 dry-run 状态），
    //       Ctrl/Cmd+Shift+Enter 直接推送（仅在启用 git 且非 dry-run 时生效）。
    //       绑定到 dialog.element 上以便整个弹窗内任意焦点都能触发。
    dialog.element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const wantPush = event.shiftKey && !!editorOptions?.gitEnabled && !dryRunInput.checked;
      submit(wantPush);
    });
  });
}
