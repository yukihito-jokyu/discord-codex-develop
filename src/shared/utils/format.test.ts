import { describe, expect, it } from "vitest";
import { DISCORD_MAX_LENGTH } from "@/shared/utils/constants";
import { formatForDiscord } from "@/shared/utils/format";

describe("formatForDiscord", () => {
  it("空文字列はそのまま返る", () => {
    expect(formatForDiscord("")).toBe("");
  });

  it("制限内のテキストはそのまま返る", () => {
    const text = "short message";
    expect(formatForDiscord(text)).toBe(text);
  });

  it("ちょうど制限バイトのテキストはそのまま返る", () => {
    const text = "a".repeat(DISCORD_MAX_LENGTH);
    expect(formatForDiscord(text)).toBe(text);
  });
});

describe("formatForDiscord: 切り詰め", () => {
  it("制限超過時は切り詰めて省略通知を付与する", () => {
    const text = "a".repeat(DISCORD_MAX_LENGTH + 100);
    const result = formatForDiscord(text);
    expect(result).toContain("... (続きは省略されました)");
    expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(
      DISCORD_MAX_LENGTH,
    );
  });

  it("日本語テキストが制限超過時にバイトベースで切り詰められる", () => {
    // 日本語1文字 = UTF-8で3バイト
    // 2000 / 3 ≈ 666文字 + 通知文で制限超過
    const text = "あ".repeat(700);
    const result = formatForDiscord(text);
    expect(result).toContain("... (続きは省略されました)");
    expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(
      DISCORD_MAX_LENGTH,
    );
  });

  it("1バイトだけ制限を超えるテキストを切り詰める", () => {
    const text = "a".repeat(DISCORD_MAX_LENGTH + 1);
    const result = formatForDiscord(text);
    expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(
      DISCORD_MAX_LENGTH,
    );
    expect(result).toContain("... (続きは省略されました)");
  });
});
