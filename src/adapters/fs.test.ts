import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyExportedAssets, writeExportedIndex } from "./fs";

describe("writeExportedIndex", () => {
  it("creates the bundle directory and writes index.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "hugo-exporter-"));

    try {
      await writeExportedIndex({
        repoRoot: root,
        relativeIndexPath: "content/posts/acfun/index.md",
        content: "---\ntitle: Acfun\n---\n\nBody\n",
        dryRun: false,
      });

      const written = await readFile(join(root, "content", "posts", "acfun", "index.md"), "utf8");
      expect(written).toBe("---\ntitle: Acfun\n---\n\nBody\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not write when dry-run is enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "hugo-exporter-"));

    try {
      const result = await writeExportedIndex({
        repoRoot: root,
        relativeIndexPath: "content/posts/acfun/index.md",
        content: "Body",
        dryRun: true,
      });

      expect(result.written).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects writes outside the repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "hugo-exporter-"));

    try {
      await expect(
        writeExportedIndex({
          repoRoot: root,
          relativeIndexPath: "../evil/index.md",
          content: "Body",
          dryRun: false,
        }),
      ).rejects.toThrow("Refuse to write outside repository");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("copyExportedAssets", () => {
  it("copies asset files into the Hugo images directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "hugo-exporter-"));
    const sourceDir = await mkdtemp(join(tmpdir(), "siyuan-assets-"));

    try {
      const sourcePath = join(sourceDir, "foo.png");
      await writeFile(sourcePath, "fake image", "utf8");

      const result = await copyExportedAssets({
        repoRoot: root,
        dryRun: false,
        assetBasePath: sourceDir,
        assetPlans: [
          {
            originalUrl: "assets/foo.png",
            sourcePath,
            targetRelativePath: "content/posts/acfun/images/foo.png",
            rewrittenUrl: "images/foo.png",
          },
        ],
      });

      const copied = await readFile(join(root, "content", "posts", "acfun", "images", "foo.png"), "utf8");
      expect(copied).toBe("fake image");
      expect(result.copied).toEqual(["content/posts/acfun/images/foo.png"]);
      expect(result.skipped).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("does not copy assets during dry-run", async () => {
    const root = await mkdtemp(join(tmpdir(), "hugo-exporter-"));
    const sourceDir = await mkdtemp(join(tmpdir(), "siyuan-assets-"));

    try {
      const sourcePath = join(sourceDir, "foo.png");
      await writeFile(sourcePath, "fake image", "utf8");

      const result = await copyExportedAssets({
        repoRoot: root,
        dryRun: true,
        assetBasePath: sourceDir,
        assetPlans: [
          {
            originalUrl: "assets/foo.png",
            sourcePath,
            targetRelativePath: "content/posts/acfun/images/foo.png",
            rewrittenUrl: "images/foo.png",
          },
        ],
      });

      expect(result.copied).toEqual([]);
      expect(result.skipped).toEqual(["content/posts/acfun/images/foo.png"]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("skips missing source files with a warning", async () => {
    const root = await mkdtemp(join(tmpdir(), "hugo-exporter-"));

    try {
      await mkdir(join(root, "content", "posts", "acfun"), { recursive: true });

      const result = await copyExportedAssets({
        repoRoot: root,
        dryRun: false,
        assetBasePath: root,
        assetPlans: [
          {
            originalUrl: "assets/missing.png",
            sourcePath: join(root, "missing.png"),
            targetRelativePath: "content/posts/acfun/images/missing.png",
            rewrittenUrl: "images/missing.png",
          },
        ],
      });

      expect(result.copied).toEqual([]);
      expect(result.skipped).toEqual(["content/posts/acfun/images/missing.png"]);
      expect(result.warnings[0]).toContain("Missing asset source");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to read sources outside assetBasePath", async () => {
    const root = await mkdtemp(join(tmpdir(), "hugo-exporter-"));
    const innocentBase = await mkdtemp(join(tmpdir(), "siyuan-base-"));
    const evilDir = await mkdtemp(join(tmpdir(), "evil-outside-"));
    const evilSource = join(evilDir, "stolen.txt");
    await writeFile(evilSource, "secret", "utf8");

    try {
      const result = await copyExportedAssets({
        repoRoot: root,
        dryRun: false,
        assetBasePath: innocentBase,
        assetPlans: [
          {
            originalUrl: "assets/../../../stolen.txt",
            sourcePath: evilSource,
            targetRelativePath: "content/posts/acfun/images/stolen.txt",
            rewrittenUrl: "images/stolen.txt",
          },
        ],
      });

      expect(result.copied).toEqual([]);
      expect(result.skipped).toEqual(["content/posts/acfun/images/stolen.txt"]);
      expect(result.warnings[0]).toContain("Refuse to copy asset outside assetBasePath");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(innocentBase, { recursive: true, force: true });
      await rm(evilDir, { recursive: true, force: true });
    }
  });

  it("reports progress incrementally for each asset", async () => {
    const root = await mkdtemp(join(tmpdir(), "hugo-exporter-"));
    const sourceDir = await mkdtemp(join(tmpdir(), "siyuan-assets-"));

    try {
      const plans = [];
      for (let i = 0; i < 4; i += 1) {
        const file = join(sourceDir, `f${i}.png`);
        await writeFile(file, `data${i}`, "utf8");
        plans.push({
          originalUrl: `assets/f${i}.png`,
          sourcePath: file,
          targetRelativePath: `content/posts/acfun/images/f${i}.png`,
          rewrittenUrl: `images/f${i}.png`,
        });
      }

      const progressEvents: Array<[number, number]> = [];
      const result = await copyExportedAssets({
        repoRoot: root,
        dryRun: false,
        assetBasePath: sourceDir,
        assetPlans: plans,
        concurrency: 2,
        onProgress: (done, total) => progressEvents.push([done, total]),
      });

      expect(result.copied).toHaveLength(4);
      expect(progressEvents.map(([d]) => d).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
      expect(progressEvents.every(([, total]) => total === 4)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });
});
