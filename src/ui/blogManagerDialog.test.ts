/**
 * 文件用途：管理博客文章弹窗的 UI 行为测试。
 * 创建日期：2026-06-02
 * 修改日期：2026-06-02
 * 语言版本：TypeScript 5.x
 * 依赖库：vitest。
 *
 * 测试策略：用极小 DOM fake 承载按钮、输入框与事件，避免引入浏览器环境依赖；
 * 重点验证 UI 层是否把用户操作正确转发给管理回调。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface ListenerMap {
  [eventName: string]: Array<(event: { preventDefault: () => void }) => void>;
}

class FakeElement {
  id = "";
  type = "";
  value = "";
  className = "";
  private ownTextContent = "";
  style = { cssText: "" };

  get textContent(): string {
    return `${this.ownTextContent}${this.children.map((child) => child.textContent).join("")}`;
  }

  set textContent(value: string) {
    this.ownTextContent = value;
  }
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  private listeners: ListenerMap = {};

  appendChild<T extends FakeElement>(child: T): T {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(eventName: string, listener: (event: { preventDefault: () => void }) => void): void {
    this.listeners[eventName] = [...(this.listeners[eventName] ?? []), listener];
  }

  click(): void {
    for (const listener of this.listeners.click ?? []) listener({ preventDefault: () => undefined });
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const result: FakeElement[] = [];
    const visit = (node: FakeElement): void => {
      if (matchesSelector(node, selector)) result.push(node);
      for (const child of node.children) visit(child);
    };
    visit(this);
    return result;
  }
}

function matchesSelector(node: FakeElement, selector: string): boolean {
  // NOTE: 测试只使用 id 与 data-testid 选择器，fake DOM 不实现完整 CSS 解析。
  if (selector.startsWith("#")) return node.id === selector.slice(1);
  const testId = selector.match(/^\[data-testid=\"([^\"]+)\"\]$/)?.[1];
  if (testId) return node.dataset.testid === testId;
  return false;
}

function installFakeDom(): void {
  globalThis.document = {
    createElement: () => new FakeElement(),
  } as unknown as Document;
}

function queryFake(root: HTMLElement, testId: string): FakeElement {
  // NOTE: 被测模块返回 HTMLElement；测试 fake DOM 需要转回 FakeElement 才能触发 click 与修改 value。
  const node = root.querySelector(`[data-testid="${testId}"]`) as unknown as FakeElement | null;
  if (!node) throw new Error(`未找到测试节点：${testId}`);
  return node;
}

const entries = [
  {
    title: "红尘第一劫",
    slug: "first-post",
    relativeIndexPath: "posts/first-post/index.md",
    bundleRelativeDir: "posts/first-post",
    status: "published" as const,
    date: "2026-05-01",
  },
  {
    title: "深渊未刊稿",
    slug: "draft-post",
    relativeIndexPath: "posts/draft-post/index.md",
    bundleRelativeDir: "posts/draft-post",
    status: "unpublished" as const,
    date: "2026-05-02",
  },
];

describe("openBlogManagerDialog", () => {
  beforeEach(() => {
    installFakeDom();
  });

  it("renders title, slug and status for every entry", async () => {
    const { openBlogManagerDialog } = await import("./blogManagerDialog");
    const handleDelete = vi.fn();

    const view = openBlogManagerDialog(entries, { onDelete: handleDelete });

    expect(view.element.textContent).toContain("红尘第一劫");
    expect(view.element.textContent).toContain("first-post");
    expect(view.element.textContent).toContain("published");
    expect(view.element.textContent).toContain("深渊未刊稿");
    expect(view.element.textContent).toContain("draft-post");
    expect(view.element.textContent).toContain("unpublished");
  });

  it("renders status buttons and delete buttons", async () => {
    const { openBlogManagerDialog } = await import("./blogManagerDialog");

    const view = openBlogManagerDialog(entries, {});

    expect(queryFake(view.element, "unpublish-first-post").textContent).toBe("下架");
    expect(queryFake(view.element, "republish-draft-post").textContent).toBe("恢复上架");
    expect(queryFake(view.element, "delete-first-post").textContent).toBe("删除");
    expect(queryFake(view.element, "delete-draft-post").textContent).toBe("删除");
  });

  it("calls onUnpublish when clicking the published entry action", async () => {
    const { openBlogManagerDialog } = await import("./blogManagerDialog");
    const handleUnpublish = vi.fn();

    const view = openBlogManagerDialog(entries, { onUnpublish: handleUnpublish });
    queryFake(view.element, "unpublish-first-post").click();

    expect(handleUnpublish).toHaveBeenCalledOnce();
    expect(handleUnpublish).toHaveBeenCalledWith(entries[0]);
  });

  it("calls onRepublish when clicking the unpublished entry action", async () => {
    const { openBlogManagerDialog } = await import("./blogManagerDialog");
    const handleRepublish = vi.fn();

    const view = openBlogManagerDialog(entries, { onRepublish: handleRepublish });
    queryFake(view.element, "republish-draft-post").click();

    expect(handleRepublish).toHaveBeenCalledOnce();
    expect(handleRepublish).toHaveBeenCalledWith(entries[1]);
  });

  it("does not call onDelete when confirmation slug does not match", async () => {
    const { openBlogManagerDialog } = await import("./blogManagerDialog");
    const handleDelete = vi.fn();

    const view = openBlogManagerDialog(entries, { onDelete: handleDelete });
    queryFake(view.element, "delete-first-post").click();
    queryFake(view.element, "delete-confirm-input-first-post").value = "wrong-slug";
    queryFake(view.element, "delete-confirm-submit-first-post").click();

    expect(handleDelete).not.toHaveBeenCalled();
  });

  it("calls onDelete when confirmation slug matches", async () => {
    const { openBlogManagerDialog } = await import("./blogManagerDialog");
    const handleDelete = vi.fn();

    const view = openBlogManagerDialog(entries, { onDelete: handleDelete });
    queryFake(view.element, "delete-first-post").click();
    queryFake(view.element, "delete-confirm-input-first-post").value = "first-post";
    queryFake(view.element, "delete-confirm-submit-first-post").click();

    expect(handleDelete).toHaveBeenCalledOnce();
    expect(handleDelete).toHaveBeenCalledWith(entries[0]);
  });
});
