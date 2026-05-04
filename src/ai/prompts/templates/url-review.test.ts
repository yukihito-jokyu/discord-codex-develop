import { describe, expect, it } from "vitest";
import { buildUrlReviewPrompt } from "./url-review";

describe("buildUrlReviewPrompt", () => {
  it("builds base prompt with URL only", () => {
    const result = buildUrlReviewPrompt("https://example.com");
    expect(result).toContain("https://example.com");
    expect(result).toContain("以下のURLの内容を読み取り、解説してください");
    expect(result).not.toContain("特に以下の点について");
  });

  it("appends question when provided", () => {
    const result = buildUrlReviewPrompt(
      "https://example.com",
      "セキュリティについて",
    );
    expect(result).toContain("特に以下の点について：セキュリティについて");
  });

  it("omits question section when question is empty string", () => {
    const result = buildUrlReviewPrompt("https://example.com", "");
    expect(result).not.toContain("特に以下の点について");
  });

  it("handles empty URL", () => {
    const result = buildUrlReviewPrompt("");
    expect(result).toContain("\n");
  });
});
