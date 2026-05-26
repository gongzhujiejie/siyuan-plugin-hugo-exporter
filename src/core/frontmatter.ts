/**
 * 文件用途：根据思源文档和 FixIt 预设生成稳定 YAML frontmatter。
 * 创建日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：js-yaml
 */
import yaml from "js-yaml";
import type { RepositoryPreset, SiYuanDocumentSnapshot } from "./types";

/**
 * parseAttrArray 将思源属性中的逗号分隔值转换成 YAML 数组。
 * 输入：形如 "靶机, Samba" 的字符串。
 * 返回：去空白、去空项后的字符串数组。
 */
function parseAttrArray(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * shouldEmitField 控制 undefined、空对象和空字符串是否输出。
 * NOTE: 空数组需要保留，因为 categories/tags/collections 在博客中有明确语义。
 */
function shouldEmitField(value: unknown): boolean {
  return value !== undefined && value !== "";
}

/**
 * buildFrontmatter 按预设顺序生成 frontmatter 对象。
 * 输入：思源文档快照、仓库预设。
 * 返回：保留插入顺序的普通对象，供 js-yaml 输出稳定字段顺序。
 */
export function buildFrontmatter(doc: SiYuanDocumentSnapshot, preset: RepositoryPreset): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const fields = [...preset.frontmatterFields].sort((a, b) => a.order - b.order);

  for (const field of fields) {
    let value: unknown = field.defaultValue;

    if (field.key === "title") {
      value = doc.title;
    } else if (field.key === "date") {
      value = doc.createdAt;
    } else if (field.key === "lastmod") {
      value = doc.updatedAt;
    } else if (field.source === "siyuan-attr" && field.siyuanAttrKey) {
      const attrValue = doc.attrs[field.siyuanAttrKey];
      value = field.type === "array" ? parseAttrArray(attrValue) : attrValue ?? field.defaultValue;
    }

    if (shouldEmitField(value)) {
      result[field.key] = value;
    }
  }

  return result;
}

/**
 * renderFrontmatterYaml 将 frontmatter 对象渲染为 Hugo 可识别的 YAML 块。
 * 输入：frontmatter 对象。
 * 返回：带前后 --- 分隔符的 YAML 字符串。
 */
export function renderFrontmatterYaml(frontmatter: Record<string, unknown>): string {
  const body = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });

  return `---\n${body}---\n`;
}
