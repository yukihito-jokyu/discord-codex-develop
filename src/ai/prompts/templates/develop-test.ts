export interface DevelopTestContext {
  diff: string;
  repo: string;
  branch: string;
}

export function buildDevelopTestPrompt(context: DevelopTestContext): string {
  return [
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "以下の実装差分に対するテストを作成してください。",
    "",
    "## リポジトリ情報",
    `- リポジトリ: ${context.repo}`,
    `- ブランチ: ${context.branch}`,
    "",
    "## 実装差分",
    context.diff,
    "",
    "## 指示",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- Vitestを使用してテストを作成してください",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- テストファイルは対象ファイルと同じディレクトリに配置してください（co-locate）",
    "- テストファイル名は `*.test.ts` の形式にしてください",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- テストケースは日本語のdescribe/itで記述してください",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- 境界値テストとエラーケースを含めてください",
    // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
    "- モックが必要な場合は vi.mock() を使用してください",
  ].join("\n");
}
