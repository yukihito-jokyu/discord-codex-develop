import { describe, expect, it } from "vitest";
import { buildDevelopTestPrompt } from "./develop-test";

describe("buildDevelopTestPrompt", () => {
  it("コンテキスト変数がプロンプトに含まれる", () => {
    const result = buildDevelopTestPrompt({
      diff: "+ function add(a, b) { return a + b; }",
      repo: "owner/repo",
      branch: "feature/1",
    });
    expect(result).toContain("+ function add(a, b) { return a + b; }");
    expect(result).toContain("owner/repo");
    expect(result).toContain("feature/1");
  });

  it("テスト規約が含まれる", () => {
    const result = buildDevelopTestPrompt({
      diff: "test diff",
      repo: "owner/repo",
      branch: "main",
    });
    expect(result).toContain("Vitest");
    expect(result).toContain("co-locate");
    expect(result).toContain("*.test.ts");
    expect(result).toContain("vi.mock()");
  });

  it("空の diff を処理する", () => {
    const result = buildDevelopTestPrompt({
      diff: "",
      repo: "owner/repo",
      branch: "main",
    });
    expect(result).toContain("テストを作成してください");
    expect(result).toContain("Vitest");
  });
});
