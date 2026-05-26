/**
 * 文件用途：处理导出 Markdown 正文，避免重复 frontmatter。
 * 创建日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：无运行时依赖。
 */

/**
 * stripExistingFrontmatter 只移除文档开头的 YAML frontmatter。
 * 输入：思源导出的 Markdown。
 * 返回：不含开头 YAML frontmatter 的正文。
 */
export function stripExistingFrontmatter(markdown: string): string {
  const normalized = markdown.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);

  if (!match) {
    return markdown;
  }

  return normalized.slice(match[0].length).replace(/^\s+/, "");
}

/**
 * composeHugoMarkdown 组合 frontmatter 和正文，并保证文件以换行结束。
 * 输入：已渲染 YAML frontmatter、Markdown 正文。
 * 返回：Hugo index.md 完整内容。
 */
export function composeHugoMarkdown(frontmatterYaml: string, markdownBody: string): string {
  const body = stripExistingFrontmatter(markdownBody).trimEnd();
  return `${frontmatterYaml.trimEnd()}\n\n${body}\n`;
}
