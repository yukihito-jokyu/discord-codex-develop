import type { IssueInfo } from "@/infrastructure/github/github.client";
import type { Phase } from "@/infrastructure/redis/thread-state.types";
import { DISCORD_MAX_LENGTH } from "@/shared/utils/constants";
import { truncateToBytes } from "@/shared/utils/truncate";

const CODE_BLOCK_OVERHEAD = "\n```".length + "```diff\n".length;
const BODY_MAX_LENGTH = 500;
const DIFF_TRUNCATION_NOTICE = "\n... (truncated)";

const PHASE_STATUS_MESSAGES: Record<Phase, string> = {
  // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
  init: "開発を開始します",
  // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
  planned: "計画が完了しました",
  // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
  developed: "実装が完了しました",
  // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
  tested: "テストが完了しました",
  committed: "コミットが完了しました",
  // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
  completed: "開発が完了しました",
};

const NEXT_STEP_MESSAGES: Record<Phase, string | null> = {
  // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
  init: "計画を作成します...",
  // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
  planned: "開発を開始します...",
  // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
  developed: "テストを実行します...",
  // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
  tested: "コミットを作成します...",
  committed: "完了しました",
  completed: null,
};

// biome-ignore lint/complexity/noStaticOnlyClass: Issue spec requires static utility class
export class MessageFormatter {
  static splitMessage(
    text: string,
    maxLength: number = DISCORD_MAX_LENGTH,
  ): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxLength) {
      let splitAt = remaining.lastIndexOf("\n", maxLength);

      if (splitAt <= 0) splitAt = maxLength;

      let chunk = remaining.slice(0, splitAt);
      remaining = remaining.slice(splitAt);

      if (remaining.startsWith("\n")) remaining = remaining.slice(1);

      const fenceCount = countCodeFences(chunk);
      if (fenceCount % 2 !== 0) {
        chunk = `${chunk}\n\`\`\``;
        remaining = `\`\`\`\n${remaining}`;
      }

      chunks.push(chunk);
    }

    if (remaining.length > 0) chunks.push(remaining);

    return chunks;
  }

  static formatDiff(diff: string): string[] {
    const available = DISCORD_MAX_LENGTH - CODE_BLOCK_OVERHEAD;

    if (Buffer.byteLength(diff, "utf-8") <= available) {
      return [`\`\`\`diff\n${diff}\n\`\`\``];
    }

    const truncated = truncateToBytes(diff, available, DIFF_TRUNCATION_NOTICE);
    return [`\`\`\`diff\n${truncated.text}\n\`\`\``];
  }

  static formatPhaseStatus(phase: Phase, issueInfo: IssueInfo): string {
    const status = PHASE_STATUS_MESSAGES[phase];
    return `Issue #${issueInfo.number}: ${issueInfo.title} の${status}`;
  }

  static formatError(error: string, phase: Phase): string {
    return `エラーが発生しました (${phase}フェーズ)\n${error}\n\n/resetでやり直せます`;
  }

  static formatInitMessage(issueInfo: IssueInfo): string {
    const bodyLine = issueInfo.body
      ? `\n説明: ${issueInfo.body.slice(0, BODY_MAX_LENGTH)}`
      : "";

    return [
      `Issue #${issueInfo.number} の開発を開始します`,
      "",
      `タイトル: ${issueInfo.title}${bodyLine}`,
      "",
      // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
      "自動で 計画→開発→テスト→コミット の流れで進めます。",
    ].join("\n");
  }

  static formatPhaseResult(phase: Phase, result: string): string[] {
    const status = PHASE_STATUS_MESSAGES[phase];
    const header = `${status}\n\n`;
    const nextStep = NEXT_STEP_MESSAGES[phase];

    let message = `${header}${result}`;
    if (nextStep) message = `${message}\n\n${nextStep}`;

    return MessageFormatter.splitMessage(message);
  }
}

function countCodeFences(text: string): number {
  let count = 0;
  const pattern = /(?<!`)```(?!`)/g;
  while (pattern.exec(text) !== null) count++;
  return count;
}
