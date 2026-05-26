/**
 * 文件用途：导出 / 推送过程中向魔尊展示分步进度的对话框。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-26
 * 语言版本：TypeScript 5.x
 * 依赖库：siyuan
 *
 * 安全说明：所有步骤标题和详情用 textContent 写入 DOM，避免日志中包含 HTML 时被解释执行。
 */
import { Dialog, showMessage } from "siyuan";

/** ProgressStatus 描述每个步骤当前的状态。 */
export type ProgressStatus = "pending" | "running" | "ok" | "warn" | "fail";

/** ProgressStep 是单个步骤的元数据。 */
export interface ProgressStep {
  id: string;
  label: string;
}

/** ProgressDialog 是 runExport/runGitPush 共用的进度反馈面板。 */
export interface ProgressDialog {
  /** addStep 提前注册一个步骤，状态默认 pending；魔尊一打开对话框就能看到流程概览。 */
  addStep(step: ProgressStep): void;
  /** update 修改步骤状态；status=running 时会自动给行加上动效。 */
  update(id: string, status: ProgressStatus, detail?: string): void;
  /** appendLog 追加一条额外日志（不绑定特定步骤），用于显示 git 输出尾行。 */
  appendLog(line: string): void;
  /** finalize 标记整体结果，启用「关闭」按钮；不会自动关闭，方便魔尊看完。 */
  finalize(success: boolean, summary: string): void;
  /**
   * setActionButton 在底部按钮栏额外加一个动作按钮（例如"仅重试推送"）。
   * 多次调用会替换上一次的按钮。传 null/undefined 隐藏按钮。
   */
  setActionButton(action: { label: string; onClick: () => void } | null): void;
  /** destroy 立即关闭对话框，仅在调用方需要时使用。 */
  destroy(): void;
}

const STATUS_ICON: Record<ProgressStatus, string> = {
  pending: "○",
  running: "▶",
  ok: "✓",
  warn: "⚠",
  fail: "✗",
};

const STATUS_COLOR: Record<ProgressStatus, string> = {
  pending: "var(--b3-theme-on-surface-light)",
  running: "var(--b3-theme-primary)",
  ok: "var(--b3-card-success-color, #2ca02c)",
  warn: "var(--b3-card-warning-color, #d97706)",
  fail: "var(--b3-card-error-color, #d33)",
};

/**
 * openProgressDialog 创建一个用于显示分步进度的对话框。
 * 输入：标题。
 * 返回：可被外部按步推进的 ProgressDialog 句柄。
 */
export function openProgressDialog(title: string): ProgressDialog {
  // NOTE: 与 frontmatter 弹窗一致，拆 scroll + sticky-footer 两层；步骤再多按钮也不会被埋。
  const root = document.createElement("div");
  root.style.cssText = "display:flex;flex-direction:column;max-height:78vh";

  const scroll = document.createElement("div");
  scroll.style.cssText =
    "padding:16px 18px 12px;display:flex;flex-direction:column;gap:10px;overflow:auto;flex:1 1 auto";
  root.appendChild(scroll);

  const stepsBox = document.createElement("div");
  stepsBox.style.cssText = "display:flex;flex-direction:column;gap:6px";
  scroll.appendChild(stepsBox);

  // NOTE: B5 — 日志区头部带"复制日志"按钮，长 stderr 一键复制反馈。
  const logHeader = document.createElement("div");
  logHeader.style.cssText =
    "display:none;justify-content:space-between;align-items:center;font-size:12px;color:var(--b3-theme-on-surface-light)";
  const logTitle = document.createElement("span");
  logTitle.textContent = "执行日志";
  const copyLogBtn = document.createElement("button");
  copyLogBtn.type = "button";
  copyLogBtn.className = "b3-button b3-button--outline";
  copyLogBtn.textContent = "复制日志";
  copyLogBtn.style.cssText = "padding:2px 10px;font-size:12px";
  logHeader.appendChild(logTitle);
  logHeader.appendChild(copyLogBtn);
  scroll.appendChild(logHeader);

  const logBox = document.createElement("pre");
  logBox.style.cssText =
    "margin:0;padding:8px;background:var(--b3-theme-surface);border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto;display:none";
  scroll.appendChild(logBox);

  const summaryBox = document.createElement("div");
  summaryBox.style.cssText = "font-weight:600";
  scroll.appendChild(summaryBox);

  const buttonBar = document.createElement("div");
  buttonBar.style.cssText =
    "display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;border-top:1px solid var(--b3-border-color);background:var(--b3-theme-background);flex:0 0 auto";
  // 占位：动作按钮（例如"仅重试推送"），默认隐藏，failure 时由调用方注入。
  let actionBtn: HTMLButtonElement | null = null;
  const closeBtn = document.createElement("button");
  closeBtn.className = "b3-button b3-button--text";
  closeBtn.textContent = "执行中…";
  closeBtn.disabled = true;
  buttonBar.appendChild(closeBtn);
  root.appendChild(buttonBar);

  const dialog = new Dialog({
    title,
    content: '<div id="hugo-progress-dialog"></div>',
    width: "620px",
    height: "auto",
  });

  const mountPoint = dialog.element.querySelector("#hugo-progress-dialog");
  if (mountPoint) mountPoint.appendChild(root);

  closeBtn.addEventListener("click", () => dialog.destroy());

  copyLogBtn.addEventListener("click", () => {
    const text = logBox.textContent ?? "";
    if (!text) {
      showMessage("当前没有可复制的日志");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(
        () => showMessage("日志已复制到剪贴板"),
        () => showMessage("复制失败，请手动选中日志再 Ctrl+C"),
      );
    } else {
      // NOTE: 旧浏览器/思源环境兜底：用临时 textarea + execCommand。
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        showMessage("日志已复制到剪贴板");
      } catch {
        showMessage("复制失败，请手动选中日志再 Ctrl+C");
      } finally {
        document.body.removeChild(ta);
      }
    }
  });

  const stepRows = new Map<string, { row: HTMLElement; icon: HTMLElement; label: HTMLElement; detail: HTMLElement }>();

  const ensureRow = (step: ProgressStep): { icon: HTMLElement; label: HTMLElement; detail: HTMLElement } => {
    if (stepRows.has(step.id)) {
      return stepRows.get(step.id)!;
    }

    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:flex-start;gap:8px";

    const icon = document.createElement("span");
    icon.style.cssText = `flex:0 0 18px;text-align:center;font-weight:700;color:${STATUS_COLOR.pending}`;
    icon.textContent = STATUS_ICON.pending;

    const label = document.createElement("div");
    label.style.cssText = "flex:1 1 auto;display:flex;flex-direction:column;gap:2px";

    const labelMain = document.createElement("span");
    labelMain.textContent = step.label;
    labelMain.style.cssText = "font-weight:500";

    const detail = document.createElement("span");
    detail.style.cssText = "color:var(--b3-theme-on-surface-light);font-size:12px;word-break:break-all";

    label.appendChild(labelMain);
    label.appendChild(detail);
    row.appendChild(icon);
    row.appendChild(label);
    stepsBox.appendChild(row);

    const handle = { row, icon, label: labelMain, detail };
    stepRows.set(step.id, handle);
    return handle;
  };

  return {
    addStep(step) {
      ensureRow(step);
    },
    update(id, status, detail) {
      const handle = stepRows.get(id);
      if (!handle) return;
      handle.icon.textContent = STATUS_ICON[status];
      handle.icon.style.color = STATUS_COLOR[status];
      if (detail !== undefined) {
        handle.detail.textContent = detail;
      }
    },
    appendLog(line) {
      logHeader.style.display = "flex";
      logBox.style.display = "block";
      // NOTE: 用 textNode 追加而非字符串拼接，避免 O(n²)。
      const text = (logBox.textContent ?? "").length > 0 ? `\n${line}` : line;
      logBox.appendChild(document.createTextNode(text));
      logBox.scrollTop = logBox.scrollHeight;
    },
    finalize(success, summary) {
      summaryBox.textContent = summary;
      summaryBox.style.color = success ? STATUS_COLOR.ok : STATUS_COLOR.fail;
      closeBtn.disabled = false;
      closeBtn.textContent = "关闭";
      // NOTE: B5 — 失败时自动展开日志区，方便魔尊一眼看到 stderr。
      if (!success && (logBox.textContent ?? "").length > 0) {
        logHeader.style.display = "flex";
        logBox.style.display = "block";
      }
    },
    setActionButton(action) {
      if (actionBtn) {
        actionBtn.remove();
        actionBtn = null;
      }
      if (!action) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "b3-button b3-button--outline";
      btn.textContent = action.label;
      btn.addEventListener("click", () => action.onClick());
      // 插入到 closeBtn 之前
      buttonBar.insertBefore(btn, closeBtn);
      actionBtn = btn;
    },
    destroy() {
      dialog.destroy();
    },
  };
}
