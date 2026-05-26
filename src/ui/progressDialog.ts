/**
 * 文件用途：导出 / 推送过程中向魔尊展示分步进度的对话框。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：siyuan
 *
 * 安全说明：所有步骤标题和详情用 textContent 写入 DOM，避免日志中包含 HTML 时被解释执行。
 */
import { Dialog } from "siyuan";

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
  const root = document.createElement("div");
  root.style.cssText = "padding:16px 18px;display:flex;flex-direction:column;gap:10px;max-height:70vh;overflow:auto";

  const stepsBox = document.createElement("div");
  stepsBox.style.cssText = "display:flex;flex-direction:column;gap:6px";
  root.appendChild(stepsBox);

  const logBox = document.createElement("pre");
  logBox.style.cssText =
    "margin:0;padding:8px;background:var(--b3-theme-surface);border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:160px;overflow:auto;display:none";
  root.appendChild(logBox);

  const summaryBox = document.createElement("div");
  summaryBox.style.cssText = "font-weight:600";
  root.appendChild(summaryBox);

  const buttonBar = document.createElement("div");
  buttonBar.style.cssText = "display:flex;justify-content:flex-end;gap:8px;padding-top:4px";
  const closeBtn = document.createElement("button");
  closeBtn.className = "b3-button b3-button--text";
  closeBtn.textContent = "执行中…";
  closeBtn.disabled = true;
  buttonBar.appendChild(closeBtn);
  root.appendChild(buttonBar);

  const dialog = new Dialog({
    title,
    content: '<div id="hugo-progress-dialog"></div>',
    width: "560px",
    height: "auto",
  });

  const mountPoint = dialog.element.querySelector("#hugo-progress-dialog");
  if (mountPoint) mountPoint.appendChild(root);

  closeBtn.addEventListener("click", () => dialog.destroy());

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
      logBox.style.display = "block";
      logBox.textContent = (logBox.textContent ? `${logBox.textContent}\n` : "") + line;
      logBox.scrollTop = logBox.scrollHeight;
    },
    finalize(success, summary) {
      summaryBox.textContent = summary;
      summaryBox.style.color = success ? STATUS_COLOR.ok : STATUS_COLOR.fail;
      closeBtn.disabled = false;
      closeBtn.textContent = "关闭";
    },
    destroy() {
      dialog.destroy();
    },
  };
}
