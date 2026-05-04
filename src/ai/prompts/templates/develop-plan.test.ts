import { describe, expect, it } from "vitest";
import { buildDevelopPlanPrompt } from "./develop-plan";

describe("buildDevelopPlanPrompt", () => {
  it("コンテキスト変数がプロンプトに含まれる", () => {
    const result = buildDevelopPlanPrompt({
      issueBody: "バグを修正する",
      repo: "owner/repo",
      branch: "main",
    });
    expect(result).toContain("バグを修正する");
    expect(result).toContain("owner/repo");
    expect(result).toContain("main");
  });

  it("期待される指示セクションが生成される", () => {
    const result = buildDevelopPlanPrompt({
      issueBody: "test",
      repo: "owner/repo",
      branch: "main",
    });
    expect(result).toContain("実行計画のみを立案");
    expect(result).toContain("コードは変更せず");
    expect(result).toContain("マークダウン形式");
  });

  it("空の issueBody を処理する", () => {
    const result = buildDevelopPlanPrompt({
      issueBody: "",
      repo: "owner/repo",
      branch: "main",
    });
    expect(result).toContain("実行計画を作成してください");
    expect(result).toContain("実行計画のみを立案");
  });
});
