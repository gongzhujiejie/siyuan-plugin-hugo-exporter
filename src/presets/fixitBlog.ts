/**
 * 文件用途：当前 Hugo/FixIt 博客的导出预设。
 * 创建日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：无运行时依赖。
 */
import type { RepositoryPreset } from "../core/types";

/**
 * FIXIT_BLOG_PRESET 匹配魔尊现有博客：content/posts/<slug>/index.md。
 * 字段顺序按当前文章 frontmatter 习惯固定，确保导出 diff 稳定。
 */
export const FIXIT_BLOG_PRESET: RepositoryPreset = {
  id: "fixit-blog-current",
  name: "FixIt Blog Current",
  contentDir: "content",
  postsDir: "posts",
  assetDirName: "images",
  bundleIndexName: "index.md",
  frontmatterFields: [
    { key: "title", label: "标题", type: "string", required: true, source: "document", order: 10 },
    { key: "date", label: "创建时间", type: "datetime", required: true, source: "document", order: 20 },
    { key: "lastmod", label: "最后修改时间", type: "datetime", required: true, source: "document", order: 30 },
    { key: "categories", label: "分类", type: "array", defaultValue: [], source: "siyuan-attr", siyuanAttrKey: "custom-hugo-categories", writeBack: true, order: 40 },
    { key: "tags", label: "标签", type: "array", defaultValue: [], source: "siyuan-attr", siyuanAttrKey: "custom-hugo-tags", writeBack: true, order: 50 },
    { key: "description", label: "描述", type: "string", defaultValue: "", source: "siyuan-attr", siyuanAttrKey: "custom-hugo-description", writeBack: true, order: 60 },
    { key: "wordCount", label: "字数统计", type: "boolean", defaultValue: true, source: "manual", order: 70 },
    { key: "math", label: "数学公式", type: "boolean", defaultValue: true, source: "manual", order: 80 },
    { key: "draft", label: "草稿", type: "boolean", defaultValue: false, source: "manual", order: 90 },
    { key: "collections", label: "合集", type: "array", defaultValue: [], source: "siyuan-attr", siyuanAttrKey: "custom-hugo-collections", writeBack: true, order: 100 },
    { key: "toc", label: "目录", type: "object", defaultValue: undefined, source: "manual", order: 110 },
    { key: "comment", label: "评论", type: "boolean", defaultValue: undefined, source: "manual", order: 120 },
    { key: "password", label: "密码", type: "string", defaultValue: undefined, source: "siyuan-attr", siyuanAttrKey: "custom-hugo-password", writeBack: false, order: 130 },
    { key: "summary", label: "摘要", type: "string", defaultValue: undefined, source: "siyuan-attr", siyuanAttrKey: "custom-hugo-summary", writeBack: true, order: 140 },
    { key: "typeit", label: "打字动画", type: "boolean", defaultValue: undefined, source: "manual", order: 150 },
  ],
};
