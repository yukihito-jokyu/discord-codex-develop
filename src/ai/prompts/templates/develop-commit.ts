export interface DevelopCommitContext {
  diff: string;
  issueNumber: number;
  issueTitle: string;
}

export function buildDevelopCommitPrompt(
  context: DevelopCommitContext,
): string {
  return [
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "以下の実装差分に基づいて、コミットメッセージを生成しコミットしてください。",
    "",
    "## Issue情報",
    `- Issue #${context.issueNumber}: ${context.issueTitle}`,
    "",
    "## 実装差分",
    context.diff,
    "",
    "## 指示",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- コミットメッセージは日本語で記述してください",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- コミットメッセージの1行目は簡潔に変更概要を記載してください",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- 必要に応じて2行目以降に詳細を記載してください",
    "- 以下のコマンドでコミットしてください:",
    "  git add -A",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    '  git commit -m "生成したコミットメッセージ"',
  ].join("\n");
}
