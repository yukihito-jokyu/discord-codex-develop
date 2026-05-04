import { describe, expect, it } from "vitest";
import { buildDevelopCommitPrompt } from "./develop-commit";

describe("buildDevelopCommitPrompt", () => {
  it("コンテキスト変数がプロンプトに含まれる", () => {
    const result = buildDevelopCommitPrompt({
      diff: "+ function hello() { return 'hi'; }",
      issueNumber: 42,
      issueTitle: "新機能を追加",
    });
    expect(result).toContain("+ function hello() { return 'hi'; }");
    expect(result).toContain("#42");
    expect(result).toContain("新機能を追加");
  });

  it("期待される指示が生成される", () => {
    const result = buildDevelopCommitPrompt({
      diff: "test diff",
      issueNumber: 1,
      issueTitle: "test",
    });
    expect(result).toContain("git add -A");
    expect(result).toContain("git commit -m");
  });

  it("空の diff を処理する", () => {
    const result = buildDevelopCommitPrompt({
      diff: "",
      issueNumber: 1,
      issueTitle: "test",
    });
    expect(result).toContain("git add -A");
  });
});
