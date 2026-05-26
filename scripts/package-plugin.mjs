/**
 * 文件用途：将构建产物整理成可手工安装到思源 data/plugins 的插件目录。
 * 创建日期：2026-05-25
 * 修改日期：2026-05-25
 * 语言版本：Node.js 22+
 * 依赖库：Node 内置 fs/promises、node:path
 */
import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

/** 插件包名必须与 plugin.json 中 name 一致，思源按该目录名识别插件。 */
const pluginName = "siyuan-plugin-hugo-exporter";

/** 项目根目录由脚本位置反推，避免依赖调用者当前工作目录。 */
const projectRoot = new URL("../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

/** releaseDir 是最终可复制到思源 plugins 目录的目录。 */
const releaseDir = join(projectRoot, ".release", pluginName);

/**
 * main 清理旧包、创建目录，并复制思源运行所需文件。
 * 安全说明：只删除项目内 .release/<pluginName>，不会触碰用户数据目录。
 */
async function main() {
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });
  await copyFile(join(projectRoot, "dist", "index.js"), join(releaseDir, "index.js"));
  await copyFile(join(projectRoot, "plugin.json"), join(releaseDir, "plugin.json"));
  await copyFile(join(projectRoot, "README.md"), join(releaseDir, "README.md"));
  await copyFile(join(projectRoot, "icon.png"), join(releaseDir, "icon.png"));
  await copyFile(join(projectRoot, "preview.png"), join(releaseDir, "preview.png"));
  await cp(join(projectRoot, "i18n"), join(releaseDir, "i18n"), { recursive: true });
  console.log(`Packaged ${pluginName} at ${releaseDir}`);
}

await main();
