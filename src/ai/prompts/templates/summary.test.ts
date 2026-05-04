import { describe, expect, it } from "vitest";
import { buildSummaryPrompt } from "./summary";

describe("buildSummaryPrompt", () => {
  it("単一コンテンツのプロンプトを生成する", () => {
    const result = buildSummaryPrompt([
      { url: "https://example.com", text: "Hello world" },
    ]);
    expect(result).toContain("https://example.com");
    expect(result).toContain("Hello world");
    expect(result).toContain("要約してください");
  });

  it("複数コンテンツのプロンプトを生成する", () => {
    const contents = [
      { url: "https://example.com", text: "Content A" },
      { url: "https://example.org", text: "Content B" },
    ];
    const result = buildSummaryPrompt(contents);
    expect(result).toContain("### https://example.com");
    expect(result).toContain("Content A");
    expect(result).toContain("### https://example.org");
    expect(result).toContain("Content B");
  });

  it("空配列を渡した場合でもヘッダーと要件は含まれる", () => {
    const result = buildSummaryPrompt([]);
    expect(result).toContain("要約してください");
    expect(result).toContain("日本語で要約してください");
    expect(result).toContain("箇条書きで含めてください");
    expect(result).toContain("各URLごとに要約を分けて記載してください");
  });
});
