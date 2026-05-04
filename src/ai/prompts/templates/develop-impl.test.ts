import { describe, expect, it } from "vitest";
import { buildDevelopImplPrompt } from "./develop-impl";

describe("buildDevelopImplPrompt", () => {
  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "コンテキスト変数がプロンプトに含まれる", () => {
    const result = buildDevelopImplPrompt({
      // biome-ignore lint/security/noSecrets: Japanese test data, not a secret
      planOutput: "ステップ1: ファイルを作成する",
      repo: "owner/repo",
      branch: "feature/1",
    });
    // biome-ignore lint/security/noSecrets: Japanese test assertion, not a secret
    expect(result).toContain("ステップ1: ファイルを作成する");
    expect(result).toContain("owner/repo");
    expect(result).toContain("feature/1");
  });

  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "期待される指示が生成される", () => {
    const result = buildDevelopImplPrompt({
      planOutput: "test",
      repo: "owner/repo",
      branch: "main",
    });
    // biome-ignore lint/security/noSecrets: Japanese test assertion, not a secret
    expect(result).toContain("計画に記載された各ステップを実装");
    expect(result).toContain("自己レビュー");
    expect(result).toContain("エラーハンドリング");
  });

  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "空の planOutput を処理する", () => {
    const result = buildDevelopImplPrompt({
      planOutput: "",
      repo: "owner/repo",
      branch: "main",
    });
    // biome-ignore lint/security/noSecrets: Japanese test assertion, not a secret
    expect(result).toContain("コードを実装してください");
    // biome-ignore lint/security/noSecrets: Japanese test assertion, not a secret
    expect(result).toContain("計画に記載された各ステップを実装");
  });
});
