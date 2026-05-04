import { describe, expect, it } from "vitest";
import { buildDevelopImplPrompt } from "./develop-impl";

describe("buildDevelopImplPrompt", () => {
  it("コンテキスト変数がプロンプトに含まれる", () => {
    const result = buildDevelopImplPrompt({
      planOutput: "ステップ1: ファイルを作成する",
      repo: "owner/repo",
      branch: "feature/1",
    });
    expect(result).toContain("ステップ1: ファイルを作成する");
    expect(result).toContain("owner/repo");
    expect(result).toContain("feature/1");
  });

  it("期待される指示が生成される", () => {
    const result = buildDevelopImplPrompt({
      planOutput: "test",
      repo: "owner/repo",
      branch: "main",
    });
    expect(result).toContain("計画に記載された各ステップを実装");
    expect(result).toContain("自己レビュー");
    expect(result).toContain("エラーハンドリング");
  });

  it("空の planOutput を処理する", () => {
    const result = buildDevelopImplPrompt({
      planOutput: "",
      repo: "owner/repo",
      branch: "main",
    });
    expect(result).toContain("コードを実装してください");
    expect(result).toContain("計画に記載された各ステップを実装");
  });
});
