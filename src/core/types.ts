/**
 * 文件用途：定义导出核心共享数据模型。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-25
 * 语言版本：TypeScript 5.x
 * 依赖库：无运行时依赖。
 */

/** FrontmatterFieldType 描述可被 UI 和序列化器共同理解的字段类型。 */
export type FrontmatterFieldType =
  | "string"
  | "boolean"
  | "datetime"
  | "array"
  | "object"
  | "enum"
  | "image";

/** FrontmatterSource 描述字段值从哪里来，用于后续 M3 的 UI 映射。 */
export type FrontmatterSource = "siyuan-attr" | "document" | "manual" | "computed";

/**
 * FrontmatterFieldConfig 是单个 frontmatter 字段的元数据。
 * defaultValue 在 M1 中直接参与默认 frontmatter 生成。
 */
export interface FrontmatterFieldConfig {
  key: string;
  label: string;
  type: FrontmatterFieldType;
  defaultValue?: unknown;
  required?: boolean;
  source: FrontmatterSource;
  siyuanAttrKey?: string;
  writeBack?: boolean;
  order: number;
}

/** RepositoryPreset 固化当前 Hugo 站点的目录和字段默认规则。 */
export interface RepositoryPreset {
  id: string;
  name: string;
  contentDir: string;
  postsDir: string;
  assetDirName: string;
  bundleIndexName: string;
  frontmatterFields: FrontmatterFieldConfig[];
}

/** SiYuanDocumentSnapshot 是导出流程从思源读取到的最小文档快照。 */
export interface SiYuanDocumentSnapshot {
  id: string;
  title: string;
  markdown: string;
  createdAt: string;
  updatedAt: string;
  attrs: Record<string, string | undefined>;
}

/** ResourcePolicy 描述 M2 资源处理的固定策略。 */
export interface ResourcePolicy {
  assetDirName: string;
  filenameStrategy: "keep" | "slugify";
  conflictStrategy: "rename" | "overwrite" | "skip" | "fail";
  rewriteMarkdownLinks: boolean;
}

/** AssetSource 描述一个在 Markdown 中发现的本地资源链接。 */
export interface AssetSource {
  originalUrl: string;
  sourcePath: string;
  fileName: string;
}

/** AssetCopyPlan 描述一个资源从源路径复制到 Hugo bundle 的计划。 */
export interface AssetCopyPlan {
  originalUrl: string;
  sourcePath: string;
  targetRelativePath: string;
  rewrittenUrl: string;
}

/** ExportInput 是导出管线的完整输入。 */
export interface ExportInput {
  doc: SiYuanDocumentSnapshot;
  repoRoot: string;
  slug?: string;
  dryRun: boolean;
  now: string;
  assetBasePath?: string;
  resourcePolicy?: ResourcePolicy;
  /**
   * frontmatterOverride 由 UI 编辑后传入；若提供，则完全覆盖默认 frontmatter，
   * 用于让用户在导出前自定义 title / categories / tags 等字段。
   */
  frontmatterOverride?: Record<string, unknown>;
  /** contentDir 用户在设置中自定义的内容目录，相对仓库根，例如 content/post。 */
  contentDir?: string;
  /** assetSubDir 用户在设置中自定义的资源子目录名，例如 images。 */
  assetSubDir?: string;
}

/** BundlePaths 是 Hugo leaf bundle 的关键路径集合。 */
export interface BundlePaths {
  slug: string;
  bundleDir: string;
  indexPath: string;
  relativeIndexPath: string;
  relativeBundleDir: string;
  relativeAssetDir: string;
}

/** ExportManifest 记录 dry-run 和真实写入时将影响的文件。 */
export interface ExportManifest {
  runId: string;
  dryRun: boolean;
  docId: string;
  slug: string;
  target: string;
  plannedWrites: string[];
  plannedDirectories: string[];
  copiedAssets: string[];
  skippedAssets: string[];
  warnings: string[];
  createdAt: string;
}

/** ExportResult 是导出流程对 UI 层返回的统一结果。 */
export interface ExportResult {
  ok: boolean;
  dryRun: boolean;
  manifest: ExportManifest;
  content?: string;
  assetPlans: AssetCopyPlan[];
  errors: string[];
}
