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
import { confirm, Dialog, Menu, showMessage } from "siyuan";
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
  /**
   * onAddOption 在用户在弹窗里输入新候选项时回调（一次可能多个）。
   * key 为 "categories" / "tags" / "collections"。
   * 调用方应把这些新值持久化到设置中的对应数组。
   */
  onAddOption?: (key: "categories" | "tags" | "collections", added: string[]) => void;
  /**
   * onRenameOption 在用户重命名候选项时回调；调用方应把 oldName→newName 应用到 config 并 saveData。
   * 同时调用方需考虑：是否把 lastForms 里所有引用 oldName 的字段也替换为 newName（推荐）。
   */
  onRenameOption?: (key: "categories" | "tags" | "collections", oldName: string, newName: string) => void;
  /** onDeleteOption 在用户从候选库永久删除某项时回调。 */
  onDeleteOption?: (key: "categories" | "tags" | "collections", name: string) => void;
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

/**
 * promptString 弹一个简单的字符串输入对话框。
 * 输入：title / message（多行 textContent）/ defaultValue / placeholder。
 * 返回：用户输入的字符串；点取消 / 关闭返回 null。
 *
 * NOTE: 思源 SDK 自带的 confirm 不接收输入，这里自建一个最小 prompt UI；
 *       不引入新依赖，所有节点都用 textContent / value 写入避免 XSS。
 */
function promptString(input: {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.style.cssText = "padding:16px 18px;display:flex;flex-direction:column;gap:10px";

    if (input.message) {
      const msg = document.createElement("div");
      msg.style.cssText =
        "font-size:12px;color:var(--b3-theme-on-surface-light);white-space:pre-wrap;word-break:break-all;line-height:1.6";
      msg.textContent = input.message;
      root.appendChild(msg);
    }

    const inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.className = "b3-text-field fn__block";
    inputEl.value = input.defaultValue ?? "";
    inputEl.placeholder = input.placeholder ?? "";
    root.appendChild(inputEl);

    const buttonBar = document.createElement("div");
    buttonBar.style.cssText = "display:flex;justify-content:flex-end;gap:8px;padding-top:4px";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "b3-button b3-button--cancel";
    cancelBtn.textContent = "取消";
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "b3-button b3-button--text";
    confirmBtn.textContent = "确定";
    buttonBar.appendChild(cancelBtn);
    buttonBar.appendChild(confirmBtn);
    root.appendChild(buttonBar);

    let resolved = false;
    const finish = (value: string | null): void => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const dialog = new Dialog({
      title: input.title,
      content: '<div id="hugo-prompt-string"></div>',
      width: "440px",
      height: "auto",
      destroyCallback: () => finish(null),
    });
    const mountPoint = dialog.element.querySelector("#hugo-prompt-string");
    if (mountPoint) mountPoint.appendChild(root);
    setTimeout(() => inputEl.focus(), 0);

    cancelBtn.addEventListener("click", () => {
      finish(null);
      dialog.destroy();
    });
    confirmBtn.addEventListener("click", () => {
      finish(inputEl.value);
      dialog.destroy();
    });
    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(inputEl.value);
        dialog.destroy();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
        dialog.destroy();
      }
    });
  });
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
 * createSelectableArrayInput 渲染 chip 多选 + 自由输入 + 候选项管理（重命名/删除）。
 * 输入：
 *   - valueBox: 容器
 *   - initialValue: 初始值（已选项）
 *   - configuredOptions: 当前候选项白名单（来自 config）
 *   - onAddOption: 用户输入新值时回调（runExport 据此写回 config）
 *   - onRenameOption: 用户重命名候选项时回调；旧值即将从候选库移除，新值加入
 *   - onDeleteOption: 用户从候选库删除某项时回调
 *
 * 设计：左键单击 chip = 切换选中（保持现状）；chip 右上角的齿轮按钮 = 进入管理菜单。
 *       这样"选中"与"管理候选"两种语义不会在同一个左键里争用，避免误删。
 */
function createSelectableArrayInput(
  valueBox: HTMLElement,
  initialValue: unknown,
  configuredOptions: string[],
  onAddOption?: (added: string[]) => void,
  onRenameOption?: (oldName: string, newName: string) => void,
  onDeleteOption?: (name: string) => void,
): () => string[] {
  let selected = parseArrayInput(stringifyArray(initialValue));
  let options = mergeOptionValues(configuredOptions, selected);
  let filterText = "";
  // configuredSet 只记"在 config 候选库里的项"，本次临时新加的（还没保存的）不能管理。
  // NOTE: 使用 Set 而非 Array.includes，候选过多时 lookup 更快。
  const configuredSet = new Set<string>(configuredOptions);

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

  /** handleRename 弹小输入对话框完成重命名，并联动更新已选项 + 通知调用方持久化。 */
  const handleRename = (oldName: string): void => {
    void promptString({
      title: "重命名候选项",
      message: `把「${oldName}」改成什么？\n\n这会同时更新本次表单里已选中的同名项。已发布的文章不受影响。`,
      defaultValue: oldName,
      placeholder: "新名称",
    }).then((nextRaw) => {
      if (nextRaw === null) return;
      const next = nextRaw.trim();
      if (!next || next === oldName) return;

      // 冲突合并：新名已存在 → 把"旧名 = 新名"，重命名等价于把 oldName 从候选移除。
      const conflict = options.includes(next) && next !== oldName;

      options = options
        .map((item) => (item === oldName ? next : item))
        .filter((item, idx, arr) => arr.indexOf(item) === idx);
      selected = selected
        .map((item) => (item === oldName ? next : item))
        .filter((item, idx, arr) => arr.indexOf(item) === idx);
      configuredSet.delete(oldName);
      configuredSet.add(next);
      renderChips();
      onRenameOption?.(oldName, next);
      if (conflict) {
        showMessage(`「${next}」已存在，已合并为同一个候选项`);
      }
    });
  };

  /** handleDelete 二次确认后从候选库移除一项，本次已选中的同名项也会被取消选中。 */
  const handleDelete = (name: string): void => {
    confirm(
      "从候选库删除",
      `把「${name}」从候选库永久删除？\n\n` +
        "• 之后再开导出弹窗都不会再出现这一项；\n" +
        "• 本次表单里若已选中此项，会自动取消选中；\n" +
        "• 已发布的文章不受影响（远端 frontmatter 里仍有这个值）。",
      () => {
        options = options.filter((item) => item !== name);
        selected = selected.filter((item) => item !== name);
        configuredSet.delete(name);
        renderChips();
        onDeleteOption?.(name);
      },
    );
  };

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
      const isManaged = configuredSet.has(option);

      // chipWrap 用 inline-flex 作为外壳，把 chip 主体和齿轮按钮当成同一个视觉单元；
      // 二者都是独立的 button，避免 DOM 嵌套 button（HTML 不允许）。
      const chipWrap = document.createElement("span");
      chipWrap.style.cssText = "display:inline-flex;align-items:stretch;border-radius:6px;overflow:hidden";

      const chip = document.createElement("button");
      chip.type = "button";
      // NOTE: 选中 vs 未选中视觉拉到极致——避免魔尊误以为所有 chip 都已写入 frontmatter。
      //       未选中：透明底 + 灰字 + 虚线边框；选中：实色高亮 + 加粗 + ✓ 前缀。
      if (active) {
        chip.className = "b3-button b3-button--text";
        chip.style.cssText =
          "padding:3px 10px;font-size:12px;border-radius:6px 0 0 6px;font-weight:600;" +
          "background:var(--b3-theme-primary);color:#fff;border:1px solid var(--b3-theme-primary)";
        chip.textContent = `✓ ${option}`;
        chip.title = "已选中：会写入 frontmatter。点击取消选中。";
      } else {
        chip.className = "b3-button b3-button--cancel";
        chip.style.cssText =
          "padding:3px 10px;font-size:12px;border-radius:6px 0 0 6px;" +
          "background:transparent;color:var(--b3-theme-on-surface-light);" +
          "border:1px dashed var(--b3-border-color);opacity:.7";
        chip.textContent = option;
        chip.title = "未选中：仅候选项，不会写入 frontmatter。点击选中。";
      }
      chip.addEventListener("click", () => {
        selected = toggleArrayValue(selected, option);
        renderChips();
      });
      chipWrap.appendChild(chip);

      // 仅"在候选库里的项"才显示管理按钮；本次临时新加的（还没 saveData）不显示。
      if (isManaged && (onRenameOption || onDeleteOption)) {
        const gear = document.createElement("button");
        gear.type = "button";
        gear.className = "b3-button b3-button--outline";
        gear.style.cssText =
          "padding:3px 6px;font-size:11px;border-left:none;border-radius:0 6px 6px 0;cursor:pointer;" +
          (active
            ? "background:var(--b3-theme-primary);color:#fff;border:1px solid var(--b3-theme-primary);border-left:1px solid rgba(255,255,255,.4)"
            : "background:transparent;color:var(--b3-theme-on-surface-light);border:1px dashed var(--b3-border-color);border-left:none;opacity:.7");
        gear.textContent = "⋯";
        gear.title = "管理候选项：重命名 / 删除";
        gear.addEventListener("click", (event) => {
          event.stopPropagation();
          const rect = gear.getBoundingClientRect();
          const menu = new Menu("hugo-chip-manage");
          if (onRenameOption) {
            menu.addItem({
              icon: "iconEdit",
              label: "重命名…",
              click: () => handleRename(option),
            });
          }
          if (onDeleteOption) {
            menu.addItem({
              icon: "iconTrashcan",
              label: "从候选库删除",
              click: () => handleDelete(option),
            });
          }
          menu.open({ x: rect.left, y: rect.bottom });
        });
        chipWrap.appendChild(gear);
      }

      chips.appendChild(chipWrap);
    }
  };

  const addCustomValue = (): void => {
    const additions = parseArrayInput(customInput.value);
    if (additions.length === 0) return;
    const newlyAdded: string[] = [];
    for (const item of additions) {
      if (!options.includes(item)) {
        options = [...options, item];
        newlyAdded.push(item);
      }
      if (!selected.includes(item)) selected = [...selected, item];
    }
    customInput.value = "";
    // NOTE: 新加的项一旦持久化（runExport 会调 onAddOption 触发 saveData），
    //       下次重开弹窗就在 configuredSet 里；这里乐观先加进去，让齿轮立即出现。
    for (const item of newlyAdded) configuredSet.add(item);
    renderChips();
    if (newlyAdded.length > 0) {
      onAddOption?.(newlyAdded);
    }
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
      const fieldKey = field.key as "categories" | "tags" | "collections";
      const onAdd = options?.onAddOption
        ? (added: string[]) => options.onAddOption?.(fieldKey, added)
        : undefined;
      const onRename = options?.onRenameOption
        ? (oldName: string, newName: string) => options.onRenameOption?.(fieldKey, oldName, newName)
        : undefined;
      const onDelete = options?.onDeleteOption
        ? (name: string) => options.onDeleteOption?.(fieldKey, name)
        : undefined;
      read = createSelectableArrayInput(valueBox, initialValue, configuredOptions, onAdd, onRename, onDelete);
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

    // NOTE: 实际写入 frontmatter 预览面板（v0.2.5 新增）。
    //       只展示真正会写进 index.md 的字段（含数组的"已选中"项）。
    //       目的：让魔尊一眼看出"灰 chip 是候选库、不会写入"，避免误以为所有 chip 都被记录。
    const previewBox = document.createElement("details");
    previewBox.style.cssText =
      "padding:6px 10px;border-radius:6px;background:var(--b3-theme-surface);font-size:12px;color:var(--b3-theme-on-surface);line-height:1.6";
    previewBox.open = true; // 默认展开，让魔尊立刻看到"实际写入"
    const previewSummary = document.createElement("summary");
    previewSummary.style.cssText = "cursor:pointer;font-weight:600";
    previewSummary.textContent = "实际写入 frontmatter（仅这些会进文章）";
    const previewBody = document.createElement("pre");
    previewBody.style.cssText =
      "margin:6px 0 0;padding:8px;background:var(--b3-theme-background);border-radius:4px;font-size:11.5px;font-family:Consolas, Monaco, monospace;white-space:pre-wrap;word-break:break-all;max-height:140px;overflow:auto";
    previewBox.appendChild(previewSummary);
    previewBox.appendChild(previewBody);
    scroll.appendChild(previewBox);

    const commonSection = createSection(scroll, "常用字段", false);
    const commonRows = fieldGroups.common.map((field) =>
      createFieldRow(commonSection, field, initial[field.key], editorOptions),
    );

    const advancedSection = createSection(scroll, "高级字段", true);
    const advancedRows = fieldGroups.advanced.map((field) =>
      createFieldRow(advancedSection, field, initial[field.key], editorOptions),
    );
    const fieldRows: FieldRow[] = [...commonRows, ...advancedRows];

    /**
     * refreshPreview 收集当前所有字段值，渲染成"实际会写入 frontmatter"的预览。
     * - 数组字段只显示已选中项（与 confirm 时写入逻辑一致）；
     * - 空字符串 / 空数组 / undefined 字段会被丢弃，与 submit 行为一致；
     * - 用 YAML 风格渲染，让魔尊看到的就是磁盘上 index.md 顶部那段。
     */
    const refreshPreview = (): void => {
      const lines: string[] = [];
      for (const row of fieldRows) {
        let value: unknown;
        try {
          value = row.read();
        } catch {
          continue;
        }
        const isEmptyArray = Array.isArray(value) && value.length === 0 && !row.field.required;
        if (value === undefined || value === "" || isEmptyArray) continue;

        if (Array.isArray(value)) {
          if (value.length === 0) continue;
          lines.push(`${row.field.key}:`);
          for (const item of value) {
            lines.push(`  - ${String(item)}`);
          }
        } else if (typeof value === "boolean") {
          lines.push(`${row.field.key}: ${value}`);
        } else if (typeof value === "object" && value !== null) {
          lines.push(`${row.field.key}: ${JSON.stringify(value)}`);
        } else {
          lines.push(`${row.field.key}: ${String(value)}`);
        }
      }
      // 永远把 title/date/lastmod 在最前面提示一下（实际写入时也会有这些）
      const head = [
        `title: ${doc.title}`,
        `date: ${doc.createdAt}`,
        `lastmod: ${doc.updatedAt}`,
      ];
      previewBody.textContent = ["---", ...head, ...lines, "---"].join("\n");
    };

    // 字段变化（输入 / 切换 chip / 改 textarea）都刷新预览。
    // capture 阶段监听，确保 chip 内部 click → renderChips → 也能触发；
    // 用 setTimeout(0) 避开 chip click handler 内部对 selected 的赋值时序。
    scroll.addEventListener("input", () => setTimeout(refreshPreview, 0), true);
    scroll.addEventListener("change", () => setTimeout(refreshPreview, 0), true);
    scroll.addEventListener("click", () => setTimeout(refreshPreview, 0), true);
    refreshPreview();

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
