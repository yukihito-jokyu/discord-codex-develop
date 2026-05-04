export interface DevelopPlanContext {
  issueBody: string;
  repo: string;
  branch: string;
}

export function buildDevelopPlanPrompt(context: DevelopPlanContext): string {
  return [
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "以下のIssueに基づいて、実行計画を作成してください。",
    "",
    "## リポジトリ情報",
    `- リポジトリ: ${context.repo}`,
    `- ブランチ: ${context.branch}`,
    "",
    "## Issue内容",
    context.issueBody,
    "",
    "## 指示",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- コードは変更せず、実行計画のみを立案してください",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- マークダウン形式で出力してください",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- 実装のステップを明確に分けて記載してください",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- 各ステップで変更対象のファイルと変更内容を記載してください",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- 必要に応じて注意点やリスクを含めてください",
  ].join("\n");
}
