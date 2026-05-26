import { describe, expect, it } from "vitest";
import { composeHugoMarkdown, stripExistingFrontmatter } from "./markdown";

describe("stripExistingFrontmatter", () => {
  it("removes a YAML frontmatter block at the start", () => {
    const input = "---\ntitle: Old\n---\n# Hello";
    expect(stripExistingFrontmatter(input)).toBe("# Hello");
  });

  it("keeps horizontal rules that are not at the start", () => {
    const input = "# Hello\n\n---\n\nBody";
    expect(stripExistingFrontmatter(input)).toBe(input);
  });
});

describe("composeHugoMarkdown", () => {
  it("joins frontmatter and body with exactly one blank line", () => {
    const output = composeHugoMarkdown("---\ntitle: Acfun\n---\n", "# Body");
    expect(output).toBe("---\ntitle: Acfun\n---\n\n# Body\n");
  });
});
