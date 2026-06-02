/**
 * 文件用途：渲染 Hugo 博客文章管理弹窗 UI 草案。
 * 创建日期：2026-06-02
 * 修改日期：2026-06-02
 * 语言版本：TypeScript 5.x
 * 依赖库：siyuan Dialog。
 *
 * 安全说明：文章标题、slug、路径与状态均通过 textContent/value 写入 DOM，避免把博客元数据当作 HTML 注入；
 * 删除操作必须二次输入 slug，只有完全匹配才调用 onDelete，降低误删风险。
 */
/** DialogConstructor 是思源 Dialog 的最小构造形状；避免测试阶段解析 siyuan 包入口。 */
interface DialogConstructor {
  new (options: { title: string; content: string; width?: string; height?: string }): BlogManagerDialogInstance;
}

/** BlogManagerDialogInstance 是本 UI 需要访问的 Dialog 最小实例能力。 */
export interface BlogManagerDialogInstance {
  element: HTMLElement;
  destroy?: () => void;
}

/** BlogPublicationStatus 表示 UI 当前支持的文章发布状态。 */
export type BlogPublicationStatus = "published" | "unpublished";

/** BlogManagerEntry 是 UI 层期望的博客文章索引项；核心实现可用兼容结构传入。 */
export interface BlogManagerEntry {
  /** title 是列表主标题，来自 frontmatter 或文档标题。 */
  title: string;
  /** slug 是文章 bundle 标识，也是删除二次确认的安全口令。 */
  slug: string;
  /** relativeIndexPath 是 index.md 在 Hugo 仓库中的相对路径，仅展示辅助定位。 */
  relativeIndexPath: string;
  /** bundleRelativeDir 是 leaf bundle 目录相对路径，仅展示辅助定位。 */
  bundleRelativeDir: string;
  /** status 控制渲染「下架」或「恢复上架」动作。 */
  status: BlogPublicationStatus;
  /** date 是文章日期字符串，UI 草案只展示不解析，避免引入时区副作用。 */
  date: string;
}

/** BlogManagerDialogOptions 承载 UI 动作回调；调用方负责真正变更文件或索引。 */
export interface BlogManagerDialogOptions {
  /** DialogClass 允许宿主注入思源 Dialog；测试或浏览器草案可使用内置 fallback。 */
  DialogClass?: DialogConstructor;
  /** onUnpublish 在 published 文章点击「下架」时触发。 */
  onUnpublish?: (entry: BlogManagerEntry) => void;
  /** onRepublish 在 unpublished 文章点击「恢复上架」时触发。 */
  onRepublish?: (entry: BlogManagerEntry) => void;
  /** onDelete 仅在 slug 二次确认完全匹配后触发。 */
  onDelete?: (entry: BlogManagerEntry) => void;
}

/** BlogManagerDialogHandle 暴露弹窗实例与根节点，便于调用方或测试做后续处理。 */
export interface BlogManagerDialogHandle {
  dialog: BlogManagerDialogInstance;
  element: HTMLElement;
}

/** MOUNT_ID 是 Dialog content 中的挂载点 id，保持唯一避免与其它弹窗冲突。 */
const MOUNT_ID = "hugo-blog-manager-dialog";

/** setTestId 为测试和未来自动化巡检添加稳定选择器，不影响思源视觉样式。 */
function setTestId(element: HTMLElement, value: string): void {
  element.dataset.testid = value;
}

/** createText 创建只写 textContent 的文本节点容器，避免使用 innerHTML。 */
function createText(tagName: keyof HTMLElementTagNameMap, text: string, className?: string): HTMLElement {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

/** createButton 创建统一样式按钮，并绑定可选点击处理器。 */
function createButton(label: string, testId: string, onClick?: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "b3-button b3-button--text";
  button.textContent = label;
  setTestId(button, testId);
  if (onClick) {
    button.addEventListener("click", (event) => {
      // NOTE: 管理动作只在当前弹窗内处理，阻止默认行为避免表单或外层容器误触发。
      event.preventDefault();
      onClick();
    });
  }
  return button;
}

/** clearChildren 清空确认区，避免反复点击删除产生多个确认输入框。 */
function clearChildren(element: HTMLElement): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

/** renderDeleteConfirmation 渲染 slug 二次确认区域；不匹配时仅提示，不触发删除。 */
function renderDeleteConfirmation(container: HTMLElement, entry: BlogManagerEntry, options: BlogManagerDialogOptions): void {
  clearChildren(container);

  const hint = createText(
    "div",
    `危险操作：请输入 slug「${entry.slug}」确认删除 ${entry.relativeIndexPath}`,
    "b3-form__space fn__smaller",
  );
  container.appendChild(hint);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "b3-text-field fn__block";
  input.value = "";
  setTestId(input, `delete-confirm-input-${entry.slug}`);
  container.appendChild(input);

  const feedback = createText("div", "", "fn__smaller");
  feedback.style.cssText = "color:var(--b3-theme-error);min-height:18px";
  container.appendChild(feedback);

  const confirmButton = createButton("确认删除", `delete-confirm-submit-${entry.slug}`, () => {
    // 二次确认必须完全匹配 slug，避免相似标题或误点导致不可逆删除。
    if (input.value.trim() !== entry.slug) {
      feedback.textContent = "slug 不匹配，未执行删除。";
      return;
    }
    feedback.textContent = "";
    options.onDelete?.(entry);
  });
  confirmButton.className = "b3-button b3-button--remove";
  container.appendChild(confirmButton);
}

/** renderEntryRow 渲染单篇文章行：元数据 + 状态动作 + 删除动作。 */
function renderEntryRow(list: HTMLElement, entry: BlogManagerEntry, options: BlogManagerDialogOptions): void {
  const row = document.createElement("article");
  row.className = "b3-card";
  row.style.cssText = "padding:12px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;gap:12px;align-items:flex-start";

  const meta = document.createElement("div");
  meta.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0";
  meta.appendChild(createText("strong", entry.title || "未命名文章"));
  meta.appendChild(createText("span", `slug：${entry.slug}`));
  meta.appendChild(createText("span", `状态：${entry.status}`));
  meta.appendChild(createText("span", `日期：${entry.date}`));
  meta.appendChild(createText("span", `路径：${entry.relativeIndexPath}`));
  meta.appendChild(createText("span", `目录：${entry.bundleRelativeDir}`));
  header.appendChild(meta);

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end";

  if (entry.status === "published") {
    actions.appendChild(createButton("下架", `unpublish-${entry.slug}`, () => options.onUnpublish?.(entry)));
  } else {
    actions.appendChild(createButton("恢复上架", `republish-${entry.slug}`, () => options.onRepublish?.(entry)));
  }

  const confirmArea = document.createElement("div");
  confirmArea.style.cssText = "display:flex;flex-direction:column;gap:6px";
  actions.appendChild(createButton("删除", `delete-${entry.slug}`, () => renderDeleteConfirmation(confirmArea, entry, options)));

  header.appendChild(actions);
  row.appendChild(header);
  row.appendChild(confirmArea);
  list.appendChild(row);
}

/** renderBlogManagerRoot 构建弹窗主体 DOM，供 openBlogManagerDialog 挂载。 */
function renderBlogManagerRoot(entries: BlogManagerEntry[], options: BlogManagerDialogOptions): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText = "padding:16px 18px;display:flex;flex-direction:column;gap:12px";

  const title = createText("h2", "管理博客文章", "b3-dialog__title");
  root.appendChild(title);
  root.appendChild(createText("div", `共 ${entries.length} 篇文章。published 可下架，unpublished 可恢复上架。`, "fn__smaller"));

  const list = document.createElement("section");
  list.style.cssText = "max-height:60vh;overflow:auto;padding-right:4px";
  if (entries.length === 0) {
    list.appendChild(createText("div", "暂无可管理的博客文章。"));
  } else {
    for (const entry of entries) renderEntryRow(list, entry, options);
  }
  root.appendChild(list);
  return root;
}

/** createFallbackDialog 在未注入思源 Dialog 时创建一个最小容器，保证 UI 草案和测试可运行。 */
function createFallbackDialog(options: { title: string; content: string }): BlogManagerDialogInstance {
  const wrapper = document.createElement("div");
  wrapper.className = "hugo-blog-manager-fallback-dialog";
  wrapper.appendChild(createText("h2", options.title));

  const mount = document.createElement("div");
  const mountId = options.content.match(/id=\"([^\"]+)\"/)?.[1];
  if (mountId) mount.id = mountId;
  wrapper.appendChild(mount);

  return {
    element: wrapper,
    destroy: () => {
      // fallback 没有外部弹层生命周期；销毁时仅从父节点移除容器。
      wrapper.parentElement?.removeChild(wrapper);
    },
  };
}

/** resolveDialogClass 优先使用调用方注入的思源 Dialog，否则退回本地最小容器。 */
function resolveDialogClass(options: BlogManagerDialogOptions): DialogConstructor {
  return options.DialogClass ?? (createFallbackDialog as unknown as DialogConstructor);
}

/**
 * openBlogManagerDialog 打开博客文章管理弹窗。
 * 输入：文章 entries 与动作回调 options。
 * 返回：Dialog handle；UI 层不碰核心算法与文件系统，所有真实变更通过回调交给调用方。
 */
export function openBlogManagerDialog(
  entries: BlogManagerEntry[],
  options: BlogManagerDialogOptions = {},
): BlogManagerDialogHandle {
  const DialogClass = resolveDialogClass(options);
  const dialog = new DialogClass({
    title: "管理博客文章",
    content: `<div id="${MOUNT_ID}"></div>`,
    width: "760px",
    height: "auto",
  });

  const root = renderBlogManagerRoot(entries, options);
  const mountPoint = dialog.element.querySelector(`#${MOUNT_ID}`);
  if (mountPoint) {
    mountPoint.appendChild(root);
  }

  return { dialog, element: root };
}
