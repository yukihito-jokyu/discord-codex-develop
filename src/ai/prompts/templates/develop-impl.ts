export interface DevelopImplContext {
  planOutput: string;
  repo: string;
  branch: string;
}

export function buildDevelopImplPrompt(context: DevelopImplContext): string {
  return [
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "以下の実行計画に従って、コードを実装してください。",
    "",
    "## リポジトリ情報",
    `- リポジトリ: ${context.repo}`,
    `- ブランチ: ${context.branch}`,
    "",
    "## 実行計画",
    context.planOutput,
    "",
    "## 指示",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- 計画に記載された各ステップを実装してください",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- 実装後、変更内容を確認して自己レビューを行ってください",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- エラーハンドリングを適切に行ってください",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- 既存のテストが通ることを確認してください",
  ].join("\n");
}
