import { describe, expect, it } from "vitest";
import {
  isInRange,
  isNonEmptyString,
  isPositiveInt,
} from "@/shared/utils/validation";

describe("isNonEmptyString", () => {
  it("returns true for a normal string", () => {
    expect(isNonEmptyString("hello")).toBe(true);
  });

  it("returns false for an empty string", () => {
    expect(isNonEmptyString("")).toBe(false);
  });

  it("returns false for whitespace-only string", () => {
    expect(isNonEmptyString("  ")).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isNonEmptyString(123)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isNonEmptyString(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isNonEmptyString(undefined)).toBe(false);
  });

  it("returns false for a boolean", () => {
    expect(isNonEmptyString(true)).toBe(false);
  });

  it("returns false for an object", () => {
    expect(isNonEmptyString({})).toBe(false);
  });

  it("returns false for an array", () => {
    expect(isNonEmptyString([])).toBe(false);
  });
});

describe("isPositiveInt", () => {
  it("returns true for 1", () => {
    expect(isPositiveInt(1)).toBe(true);
  });

  it("returns true for 100", () => {
    expect(isPositiveInt(100)).toBe(true);
  });

  it("returns false for 0", () => {
    expect(isPositiveInt(0)).toBe(false);
  });

  it("returns false for a negative number", () => {
    expect(isPositiveInt(-1)).toBe(false);
  });

  it("returns false for a decimal", () => {
    expect(isPositiveInt(1.5)).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isPositiveInt("1")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isPositiveInt(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isPositiveInt(undefined)).toBe(false);
  });

  it("returns false for NaN", () => {
    expect(isPositiveInt(Number.NaN)).toBe(false);
  });

  it("returns false for Infinity", () => {
    expect(isPositiveInt(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("isInRange", () => {
  it("returns true for a value within range", () => {
    expect(isInRange(5, 1, 10)).toBe(true);
  });

  it("returns true at the min boundary", () => {
    expect(isInRange(1, 1, 10)).toBe(true);
  });

  it("returns true at the max boundary", () => {
    expect(isInRange(10, 1, 10)).toBe(true);
  });

  it("returns false below the min boundary", () => {
    expect(isInRange(0, 1, 10)).toBe(false);
  });

  it("returns false above the max boundary", () => {
    expect(isInRange(11, 1, 10)).toBe(false);
  });

  it("returns true when min equals max and value matches", () => {
    expect(isInRange(5, 5, 5)).toBe(true);
  });

  it("returns false when min equals max and value differs", () => {
    expect(isInRange(4, 5, 5)).toBe(false);
  });

  it("works with negative range", () => {
    expect(isInRange(-3, -5, -1)).toBe(true);
  });

  it("returns false for value outside negative range", () => {
    expect(isInRange(0, -5, -1)).toBe(false);
  });
});
