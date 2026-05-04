import { describe, expect, it } from "vitest";
import { truncateToBytes } from "./truncate";

describe("truncateToBytes", () => {
  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "制限内のテキストはそのまま返る", () => {
    const result = truncateToBytes("hello", 100);
    expect(result.text).toBe("hello");
    expect(result.wasTruncated).toBe(false);
  });

  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "制限超過テキストは切り詰められる", () => {
    const text = "a".repeat(1000);
    const result = truncateToBytes(text, 100);
    expect(result.wasTruncated).toBe(true);
    expect(result.text).toContain("... (truncated)");
    expect(Buffer.byteLength(result.text, "utf-8")).toBeLessThanOrEqual(100);
  });

  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "境界値: ちょうど制限のテキストは切り詰められない", () => {
    const text = "あいうえお";
    const exactBytes = Buffer.byteLength(text, "utf-8");
    const result = truncateToBytes(text, exactBytes);
    expect(result.text).toBe(text);
    expect(result.wasTruncated).toBe(false);
  });

  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "空文字列入力を処理する", () => {
    const result = truncateToBytes("", 100);
    expect(result.text).toBe("");
    expect(result.wasTruncated).toBe(false);
  });

  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "マルチバイト文字が途中で分割されない", () => {
    const text = "あいうえおかきくけこ";
    const result = truncateToBytes(text, 20);
    expect(result.wasTruncated).toBe(true);
    const body = result.text.replace("\n\n... (truncated)", "");
    for (const char of body) {
      expect("あいうえおかきくけこ".includes(char)).toBe(true);
    }
  });
});

// biome-ignore lint/security/noSecrets: describe block name, not a secret
describe("truncateToBytes: カスタム通知文", () => {
  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "カスタム通知文を使用できる", () => {
    const text = "a".repeat(1000);
    // biome-ignore lint/security/noSecrets: static Japanese notice text, not a secret
    const notice = "\n\n... (続きは省略されました)";
    const result = truncateToBytes(text, 100, notice);
    expect(result.wasTruncated).toBe(true);
    // biome-ignore lint/security/noSecrets: static Japanese notice text, not a secret
    expect(result.text).toContain("続きは省略されました)");
    expect(result.text).not.toContain("... (truncated)");
    expect(Buffer.byteLength(result.text, "utf-8")).toBeLessThanOrEqual(100);
  });
});

// biome-ignore lint/security/noSecrets: describe block name, not a secret
describe("truncateToBytes: 境界値", () => {
  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "1バイトだけ制限を超えるテキストを切り詰める", () => {
    const text = "a".repeat(101);
    const result = truncateToBytes(text, 100);
    expect(result.wasTruncated).toBe(true);
    expect(Buffer.byteLength(result.text, "utf-8")).toBeLessThanOrEqual(100);
    expect(result.text).toContain("... (truncated)");
  });

  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "maxBytesが通知文のバイト長と等しい場合、本文は空になる", () => {
    const notice = "\n\n... (truncated)";
    const noticeBytes = Buffer.byteLength(notice, "utf-8");
    const text = "a".repeat(noticeBytes + 10);
    const result = truncateToBytes(text, noticeBytes);
    expect(result.wasTruncated).toBe(true);
    expect(result.text).toBe(notice);
    expect(Buffer.byteLength(result.text, "utf-8")).toBe(noticeBytes);
  });

  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "通知文のバイト長がmaxBytesを超える場合でも切り詰めは実行される", () => {
    const text = "a".repeat(200);
    const longNotice = "X".repeat(200);
    const result = truncateToBytes(text, 100, longNotice);
    expect(result.wasTruncated).toBe(true);
    expect(result.text).toBe(longNotice);
  });

  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "ASCIIとマルチバイト混在テキストの切り詰め境界で文字が分割されない", () => {
    const text = "aあaあaあaあaあ";
    const shortNotice = "…";
    const result = truncateToBytes(text, 10, shortNotice);
    expect(result.wasTruncated).toBe(true);
    expect(Buffer.byteLength(result.text, "utf-8")).toBeLessThanOrEqual(10);
    const body = result.text.slice(0, -shortNotice.length);
    for (const char of body) {
      expect("aあ").toContain(char);
    }
  });

  it(// biome-ignore lint/security/noSecrets: test description, not a secret
  "maxBytesが0の場合、切り詰め結果は通知文のみになる", () => {
    const text = "hello";
    const result = truncateToBytes(text, 0);
    expect(result.wasTruncated).toBe(true);
    expect(result.text).toBe("\n\n... (truncated)");
  });
});
