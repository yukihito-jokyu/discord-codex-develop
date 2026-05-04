import { describe, expect, it } from "vitest";
import { buildGeneralChatPrompt } from "./general-chat";

describe("buildGeneralChatPrompt", () => {
  it("returns message as-is", () => {
    const result = buildGeneralChatPrompt("こんにちは");
    expect(result).toBe("こんにちは");
  });

  it("returns empty string as-is", () => {
    const result = buildGeneralChatPrompt("");
    expect(result).toBe("");
  });
});
