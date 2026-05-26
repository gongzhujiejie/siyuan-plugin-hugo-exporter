import type { SiYuanDocumentSnapshot } from "../core/types";

/** 当前博客 Acfun 文章的最小思源文档快照，用于集成测试。 */
export const acfunDoc: SiYuanDocumentSnapshot = {
  id: "20260525120000-acfun00",
  title: "Acfun",
  markdown: "## 端口扫描\n\n```bash\nnmap -sV -A 192.168.56.163\n```\n",
  createdAt: "2026-04-27T10:11:26+08:00",
  updatedAt: "2026-04-28T20:15:59+08:00",
  attrs: {
    "custom-hugo-categories": "MAZESEC",
    "custom-hugo-tags": "靶机",
    "custom-hugo-description": "Acfun 靶机完整渗透流程",
    "custom-hugo-collections": "MAZESEC Writeups",
  },
};

/** 带本地与远程资源的文档快照，用于 M2 资源映射测试。 */
export const acfunDocWithAssets: SiYuanDocumentSnapshot = {
  ...acfunDoc,
  markdown:
    "## 截图\n\n" +
    "![local](assets/PixPin_2026-04-27_10-25-12-20260427102514-kze3mcy.png)\n\n" +
    "![remote](https://example.com/remote.png)\n",
};
