import { describe, expect, it } from "vitest";
import { buildDevelopPlanPrompt } from "./develop-plan";

describe("buildDevelopPlanPrompt", () => {
  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "コンテキスト変数がプロンプトに含まれる", () => {
    const result = buildDevelopPlanPrompt({
      // biome-ignore lint/security/noSecrets: Japanese test data, not a secret
      issueBody: "バグを修正する",
      repo: "owner/repo",
      branch: "main",
    });
    // biome-ignore lint/security/noSecrets: Japanese test assertion, not a secret
    expect(result).toContain("バグを修正する");
    expect(result).toContain("owner/repo");
    expect(result).toContain("main");
  });

  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "期待される指示セクションが生成される", () => {
    const result = buildDevelopPlanPrompt({
      issueBody: "test",
      repo: "owner/repo",
      branch: "main",
    });
    // biome-ignore lint/security/noSecrets: Japanese test assertion, not a secret
    expect(result).toContain("実行計画のみを立案");
    // biome-ignore lint/security/noSecrets: Japanese test assertion, not a secret
    expect(result).toContain("コードは変更せず");
    expect(result).toContain("マークダウン形式");
  });

  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "空の issueBody を処理する", () => {
    const result = buildDevelopPlanPrompt({
      issueBody: "",
      repo: "owner/repo",
      branch: "main",
    });
    // biome-ignore lint/security/noSecrets: Japanese test assertion, not a secret
    expect(result).toContain("実行計画を作成してください");
    // biome-ignore lint/security/noSecrets: Japanese test assertion, not a secret
    expect(result).toContain("実行計画のみを立案");
  });
});
