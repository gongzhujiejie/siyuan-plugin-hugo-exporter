# Hugo Exporter for SiYuan

将当前思源文档导出为 Hugo leaf bundle：

```text
content/posts/<slug>/index.md
content/posts/<slug>/images/<asset>
```

## 手工安装

1. 在本项目目录运行：

   ```powershell
   pnpm package
   ```

2. 将 `.release/siyuan-plugin-hugo-exporter` 整个目录复制到思源工作空间：

   ```text
   <SiYuan 工作空间>/data/plugins/siyuan-plugin-hugo-exporter
   ```

3. 重启思源，在 `设置 → 集市 → 已下载` 中启用 `Hugo 导出器`。

## 使用

1. 打开插件设置。
2. 配置 Hugo 仓库路径，例如：`I:/my-blog`。
3. 配置思源资源根路径，通常是：`<SiYuan 工作空间>/data`。
4. 先执行 `Hugo Dry-run` 检查计划写入文件。
5. 确认无误后执行 `Hugo: 导出当前文档`。

## 当前能力

- 生成 `index.md`。
- 生成 YAML frontmatter。
- 将本地 Markdown 资源链接改写为 `images/<file>`。
- 复制资源到 `content/posts/<slug>/images/`。
- 保留远程链接不变。
