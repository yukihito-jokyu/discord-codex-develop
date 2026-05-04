import { describe, expect, it } from "vitest";
import type { IssueInfo } from "@/infrastructure/github/github.client";
import type { Phase } from "@/infrastructure/redis/thread-state.types";
import { DISCORD_MAX_LENGTH } from "@/shared/utils/constants";
import { MessageFormatter } from "./message-formatter";

function createIssueInfo(overrides: Partial<IssueInfo> = {}): IssueInfo {
  return {
    number: 42,
    title: "Test Issue",
    body: "This is a test issue body",
    owner: "test-owner",
    repo: "test-repo",
    state: "open",
    labels: [],
    assignees: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("MessageFormatter.splitMessage basic", () => {
  it("returns single-element array for text under limit", () => {
    const text = "Hello, world!";
    const result = MessageFormatter.splitMessage(text);
    expect(result).toEqual(["Hello, world!"]);
  });

  it("returns single-element array for text at exactly maxLength", () => {
    const text = "a".repeat(DISCORD_MAX_LENGTH);
    const result = MessageFormatter.splitMessage(text);
    expect(result).toEqual([text]);
    expect(result).toHaveLength(1);
  });

  it("returns array with empty string for empty input", () => {
    const result = MessageFormatter.splitMessage("");
    expect(result).toEqual([""]);
  });
});

describe("MessageFormatter.splitMessage splitting", () => {
  it("splits text over maxLength into multiple chunks", () => {
    const line = "a".repeat(1000);
    const text = `${line}\n${line}\n${line}`;
    const result = MessageFormatter.splitMessage(text);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_MAX_LENGTH);
    }
  });

  it("splits at newline boundaries", () => {
    const line = "a".repeat(1500);
    const text = `${line}\n${line}`;
    const result = MessageFormatter.splitMessage(text);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(line);
    expect(result[1]).toBe(line);
  });

  it("handles text with no newlines by hard splitting", () => {
    const text = "a".repeat(DISCORD_MAX_LENGTH + 100);
    const result = MessageFormatter.splitMessage(text);
    expect(result.length).toBe(2);
    expect(result[0].length).toBeLessThanOrEqual(DISCORD_MAX_LENGTH);
  });

  it("splits text of maxLength + 1 into exactly two chunks", () => {
    const text = "a".repeat(DISCORD_MAX_LENGTH + 1);
    const result = MessageFormatter.splitMessage(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("a".repeat(DISCORD_MAX_LENGTH));
    expect(result[1]).toBe("a");
  });

  it("hard splits when only newline is at position 0", () => {
    const text = `\n${"a".repeat(DISCORD_MAX_LENGTH)}`;
    const result = MessageFormatter.splitMessage(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(`\n${"a".repeat(DISCORD_MAX_LENGTH - 1)}`);
    expect(result[1]).toBe("a");
  });
});

describe("MessageFormatter.splitMessage code blocks", () => {
  it("closes and reopens code blocks at split boundaries", () => {
    const code = "a".repeat(1990);
    const text = `\`\`\`\n${code}\nmore content`;
    const result = MessageFormatter.splitMessage(text);
    expect(result.length).toBeGreaterThan(1);
    expect(result[0].endsWith("```")).toBe(true);
    expect(result[1].startsWith("```")).toBe(true);
  });

  it("does not confuse inline code with code fences", () => {
    const text = `some \`inline code\` here\n${"b".repeat(2000)}`;
    const result = MessageFormatter.splitMessage(text);
    expect(result.length).toBe(2);
    expect(result[0]).toBe("some `inline code` here");
  });

  it("handles multiple code blocks correctly", () => {
    const block1 = "x".repeat(800);
    const block2 = "y".repeat(800);
    const text = `\`\`\`\n${block1}\n\`\`\`\nmiddle\n\`\`\`\n${block2}\n\`\`\``;
    const result = MessageFormatter.splitMessage(text);
    for (const chunk of result) {
      const fences = chunk.match(/(?<!`)```(?!`)/g);
      if (fences) {
        expect(fences.length % 2).toBe(0);
      }
    }
  });
});

describe("MessageFormatter.formatDiff", () => {
  it("wraps short diff in diff code block", () => {
    const diff = "+ added line\n- removed line";
    const result = MessageFormatter.formatDiff(diff);
    expect(result).toEqual(["```diff\n+ added line\n- removed line\n```"]);
  });

  it("truncates long diff with notice", () => {
    const diff = "+ ".repeat(5000);
    const result = MessageFormatter.formatDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].startsWith("```diff\n")).toBe(true);
    expect(result[0].endsWith("\n```")).toBe(true);
    expect(result[0]).toContain("... (truncated)");
    expect(result[0].length).toBeLessThanOrEqual(DISCORD_MAX_LENGTH);
  });

  it("returns code block for empty diff", () => {
    const result = MessageFormatter.formatDiff("");
    expect(result).toEqual(["```diff\n\n```"]);
  });

  it("does not truncate when diff byte length exactly equals available space", () => {
    const codeBlockOverhead = "\n```".length + "```diff\n".length;
    const available = DISCORD_MAX_LENGTH - codeBlockOverhead;
    const diff = "+".repeat(available);

    const result = MessageFormatter.formatDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toContain("... (truncated)");
  });
});

describe("MessageFormatter.formatPhaseStatus", () => {
  const phases: Phase[] = [
    "init",
    "planned",
    "developed",
    "tested",
    "committed",
    "completed",
  ];

  it.each(phases)("generates correct message for phase %s", (phase) => {
    const issueInfo = createIssueInfo({ number: 42, title: "Fix bug" });
    const result = MessageFormatter.formatPhaseStatus(phase, issueInfo);
    expect(result).toContain("Issue #42");
    expect(result).toContain("Fix bug");
  });

  it("includes issue number and title", () => {
    const issueInfo = createIssueInfo({ number: 99, title: "New Feature" });
    const result = MessageFormatter.formatPhaseStatus("init", issueInfo);
    // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
    expect(result).toBe("Issue #99: New Feature の開発を開始します");
  });
});

describe("MessageFormatter.formatError", () => {
  it("includes error text", () => {
    const result = MessageFormatter.formatError("Something went wrong", "init");
    expect(result).toContain("Something went wrong");
  });

  it("includes reset guidance", () => {
    const result = MessageFormatter.formatError("Error", "planned");
    // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
    expect(result).toContain("/resetでやり直せます");
  });

  it("includes phase name", () => {
    const result = MessageFormatter.formatError("Error", "tested");
    expect(result).toContain("testedフェーズ");
  });
});

describe("MessageFormatter.formatInitMessage", () => {
  it("includes issue number and title", () => {
    const issueInfo = createIssueInfo({ number: 7, title: "Add feature" });
    const result = MessageFormatter.formatInitMessage(issueInfo);
    expect(result).toContain("Issue #7");
    expect(result).toContain("Add feature");
  });

  it("includes body when present", () => {
    const issueInfo = createIssueInfo({ body: "Detailed description" });
    const result = MessageFormatter.formatInitMessage(issueInfo);
    expect(result).toContain("説明: Detailed description");
  });

  it("omits body line when body is null", () => {
    const issueInfo = createIssueInfo({ body: null });
    const result = MessageFormatter.formatInitMessage(issueInfo);
    expect(result).not.toContain("説明:");
  });

  it("truncates long body to 500 characters", () => {
    const issueInfo = createIssueInfo({ body: "x".repeat(1000) });
    const result = MessageFormatter.formatInitMessage(issueInfo);
    const bodyLine = result.split("\n").find((l) => l.startsWith("説明:"));
    expect(bodyLine).toBeDefined();
    expect(bodyLine?.length).toBeLessThanOrEqual("説明: ".length + 500);
  });

  it("does not truncate body when exactly 500 characters", () => {
    const issueInfo = createIssueInfo({ body: "x".repeat(500) });
    const result = MessageFormatter.formatInitMessage(issueInfo);
    const bodyLine = result.split("\n").find((l) => l.startsWith("説明:"));
    expect(bodyLine).toBe(`説明: ${"x".repeat(500)}`);
  });
});

describe("MessageFormatter.formatPhaseResult", () => {
  it("includes result text", () => {
    const result = MessageFormatter.formatPhaseResult("init", "Plan created");
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((r) => r.includes("Plan created"))).toBe(true);
  });

  it("includes next step for non-completed phases", () => {
    const result = MessageFormatter.formatPhaseResult("init", "done");
    // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
    expect(result.some((r) => r.includes("計画を作成します..."))).toBe(true);
  });

  it("does not include next step for completed phase", () => {
    const result = MessageFormatter.formatPhaseResult("completed", "All done");
    expect(result.every((r) => !r.includes("..."))).toBe(true);
  });

  it("splits long results into multiple messages", () => {
    const longResult = "x".repeat(DISCORD_MAX_LENGTH + 1000);
    const result = MessageFormatter.formatPhaseResult("init", longResult);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_MAX_LENGTH);
    }
  });

  it.each([
    // biome-ignore lint/security/noSecrets: false positive on Japanese test strings
    ["planned", "開発を開始します..."],
    // biome-ignore lint/security/noSecrets: false positive on Japanese test strings
    ["developed", "テストを実行します..."],
    // biome-ignore lint/security/noSecrets: false positive on Japanese test strings
    ["tested", "コミットを作成します..."],
  ] as [
    Phase,
    string,
  ][])("includes correct next step for %s phase", (phase, nextStep) => {
    const result = MessageFormatter.formatPhaseResult(phase, "done");
    expect(result.some((r) => r.includes(nextStep))).toBe(true);
  });

  it("includes completion message for committed phase", () => {
    const result = MessageFormatter.formatPhaseResult("committed", "done");
    expect(result.some((r) => r.includes("完了しました"))).toBe(true);
  });
});
