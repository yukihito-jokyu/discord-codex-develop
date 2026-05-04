import { beforeEach, describe, expect, it, vi } from "vitest";

const mockChat = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDelete = vi.fn();

vi.mock("../client/openai.client", () => ({
  // biome-ignore lint/complexity/useArrowFunction: constructor mock requires function expression
  OpenAIClient: vi.fn().mockImplementation(function () {
    return { chat: mockChat };
  }),
}));

vi.mock("@/infrastructure/redis/redis.client", () => ({
  // biome-ignore lint/complexity/useArrowFunction: constructor mock requires function expression
  RedisClient: vi.fn().mockImplementation(function () {
    return {
      get: mockRedisGet,
      set: mockRedisSet,
      delete: mockRedisDelete,
    };
  }),
}));

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

async function createService() {
  const { AIService } = await import("./ai.service");
  const { OpenAIClient } = await import("../client/openai.client");
  const { RedisClient } = await import("@/infrastructure/redis/redis.client");
  return new AIService(
    new (OpenAIClient as ReturnType<typeof vi.fn>)(),
    new (RedisClient as unknown as ReturnType<typeof vi.fn>)(),
  );
}

describe("AIService chat new conversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockChat.mockResolvedValue({
      response: "AI response",
      usage: null,
    });
    mockRedisSet.mockResolvedValue(undefined);
  });

  it("starts with system prompt when no Redis history", async () => {
    const service = await createService();
    const result = await service.chat("channel-1", "Hello");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("AI response");
    }
  });

  it("saves JSON message history to Redis with TTL", async () => {
    const service = await createService();
    await service.chat("channel-1", "Hello");
    expect(mockRedisSet).toHaveBeenCalledWith(
      "messages:channel-1",
      expect.any(String),
      { ttlMs: 86400000 },
    );
    const savedValue = JSON.parse(
      mockRedisSet.mock.calls[0][1] as string,
    ) as Array<{ role: string; content: string }>;
    expect(savedValue).toHaveLength(3);
    expect(savedValue[0].role).toBe("system");
    expect(savedValue[1].role).toBe("user");
    expect(savedValue[1].content).toBe("Hello");
    expect(savedValue[2].role).toBe("assistant");
    expect(savedValue[2].content).toBe("AI response");
  });

  it("passes messages array with system prompt to client.chat", async () => {
    const service = await createService();
    await service.chat("channel-1", "Hello");
    expect(mockChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("AIアシスタント"),
        }),
        expect.objectContaining({ role: "user", content: "Hello" }),
      ]),
    );
  });
});

describe("AIService chat existing conversation", () => {
  const existingHistory = JSON.stringify([
    { role: "system", content: "You are helpful" },
    { role: "user", content: "First message" },
    { role: "assistant", content: "First response" },
  ]);

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(existingHistory);
    mockChat.mockResolvedValue({
      response: "Continued response",
      usage: null,
    });
    mockRedisSet.mockResolvedValue(undefined);
  });

  it("appends user message to existing history", async () => {
    const service = await createService();
    const result = await service.chat("channel-2", "Continue");
    expect(mockChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "system", content: "You are helpful" }),
        expect.objectContaining({
          role: "user",
          content: "First message",
        }),
        expect.objectContaining({
          role: "assistant",
          content: "First response",
        }),
        expect.objectContaining({ role: "user", content: "Continue" }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("Continued response");
    }
  });

  it("appends assistant response and saves full history", async () => {
    const service = await createService();
    await service.chat("channel-2", "Continue");
    const savedValue = JSON.parse(
      mockRedisSet.mock.calls[0][1] as string,
    ) as Array<{ role: string; content: string }>;
    expect(savedValue).toHaveLength(5);
    expect(savedValue[4].role).toBe("assistant");
    expect(savedValue[4].content).toBe("Continued response");
  });
});

describe("AIService chat error handling Redis get", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ExternalServiceError for Redis on redis.get failure", async () => {
    mockRedisGet.mockRejectedValue(new Error("connection refused"));
    const service = await createService();
    const result = await service.chat("channel-3", "Hello");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe("ExternalServiceError");
      expect(result.error.message).toContain("Redis");
      expect(result.error.message).toContain("connection refused");
    }
  });

  it("handles non-Error thrown value from Redis on redis.get", async () => {
    mockRedisGet.mockRejectedValue(42);
    const service = await createService();
    const result = await service.chat("channel-3", "Hello");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("42");
    }
  });
});

describe("AIService chat error handling OpenAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ExternalServiceError for OpenAI on client failure", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockChat.mockRejectedValue(new Error("API rate limit"));
    const service = await createService();
    const result = await service.chat("channel-3", "Hello");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe("ExternalServiceError");
      expect(result.error.message).toContain("OpenAI");
      expect(result.error.message).toContain("API rate limit");
    }
  });

  it("handles non-Error thrown value from OpenAI", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockChat.mockRejectedValue("string error");
    const service = await createService();
    const result = await service.chat("channel-3", "Hello");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("string error");
    }
  });
});

describe("AIService chat error handling Redis set", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ExternalServiceError for Redis on redis.set failure", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockChat.mockResolvedValue({
      response: "AI response",
      usage: null,
    });
    mockRedisSet.mockRejectedValue(new Error("write failed"));
    const service = await createService();
    const result = await service.chat("channel-3", "Hello");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe("ExternalServiceError");
      expect(result.error.message).toContain("Redis");
      expect(result.error.message).toContain("write failed");
    }
  });

  it("handles non-Error thrown value from Redis on redis.set", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockChat.mockResolvedValue({
      response: "AI response",
      usage: null,
    });
    mockRedisSet.mockRejectedValue(99);
    const service = await createService();
    const result = await service.chat("channel-3", "Hello");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("99");
    }
  });
});

describe("AIService chat includes system prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockChat.mockResolvedValue({
      response: "AI response",
      usage: null,
    });
    mockRedisSet.mockResolvedValue(undefined);
  });

  it("includes system prompt in messages array", async () => {
    const service = await createService();
    await service.chat("channel-sys", "Hello");
    expect(mockChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("AIアシスタント"),
        }),
      ]),
    );
  });
});

describe("AIService chat boundary 2000 chars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue(undefined);
  });

  it("does not truncate response of exactly 2000 characters", async () => {
    const exactResponse = "a".repeat(2000);
    mockChat.mockResolvedValue({
      response: exactResponse,
      usage: null,
    });
    const service = await createService();
    const result = await service.chat("channel-2000", "Hello");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(2000);
      expect(result.value).not.toContain("省略");
    }
  });

  it("truncates response of 2001 characters", async () => {
    const overResponse = "a".repeat(2001);
    mockChat.mockResolvedValue({
      response: overResponse,
      usage: null,
    });
    const service = await createService();
    const result = await service.chat("channel-2001", "Hello");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeLessThanOrEqual(2000);
      expect(result.value).toContain("省略");
    }
  });
});

describe("AIService chat long response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    const longResponse = "a".repeat(3000);
    mockChat.mockResolvedValue({
      response: longResponse,
      usage: null,
    });
    mockRedisSet.mockResolvedValue(undefined);
  });

  it("truncates response over 2000 characters", async () => {
    const service = await createService();
    const result = await service.chat("channel-4", "Long response");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeLessThanOrEqual(2000);
      expect(result.value).toContain("省略");
    }
  });
});

describe("AIService resetConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisDelete.mockResolvedValue(undefined);
  });

  it("deletes messages key from Redis", async () => {
    const service = await createService();
    await service.resetConversation("channel-5");
    expect(mockRedisDelete).toHaveBeenCalledWith("messages:channel-5");
  });

  it("propagates error when redis.delete fails", async () => {
    mockRedisDelete.mockRejectedValue(new Error("redis down"));
    const service = await createService();
    await expect(service.resetConversation("channel-5")).rejects.toThrow(
      "redis down",
    );
  });
});

describe("AIService chat empty history from Redis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue("");
    mockChat.mockResolvedValue({
      response: "New response",
      usage: null,
    });
    mockRedisSet.mockResolvedValue(undefined);
  });

  it("starts fresh when Redis returns empty string", async () => {
    const service = await createService();
    await service.chat("channel-empty", "Hello");
    expect(mockChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("AIアシスタント"),
        }),
        expect.objectContaining({ role: "user", content: "Hello" }),
      ]),
    );
  });
});

describe("AIService linkThreadChannel success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("copies message history to thread channel with TTL", async () => {
    const history = JSON.stringify([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ]);
    mockRedisGet.mockResolvedValue(history);
    mockRedisSet.mockResolvedValue(undefined);
    const service = await createService();

    await service.linkThreadChannel("channel-orig", "thread-ch");

    expect(mockRedisGet).toHaveBeenCalledWith("messages:channel-orig");
    expect(mockRedisSet).toHaveBeenCalledWith("messages:thread-ch", history, {
      ttlMs: 86400000,
    });
  });

  it("does not call redis.set when original channel has no history", async () => {
    mockRedisGet.mockResolvedValue(null);
    const service = await createService();

    await service.linkThreadChannel("channel-orig", "thread-ch");

    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it("does not call redis.set when history is empty string", async () => {
    mockRedisGet.mockResolvedValue("");
    const service = await createService();

    await service.linkThreadChannel("channel-orig", "thread-ch");

    expect(mockRedisSet).not.toHaveBeenCalled();
  });
});

describe("AIService linkThreadChannel error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates error when redis.get fails", async () => {
    mockRedisGet.mockRejectedValue(new Error("connection lost"));
    const service = await createService();

    await expect(
      service.linkThreadChannel("channel-orig", "thread-ch"),
    ).rejects.toThrow("connection lost");
  });

  it("propagates error when redis.set fails", async () => {
    mockRedisGet.mockResolvedValue(
      JSON.stringify([{ role: "system", content: "test" }]),
    );
    mockRedisSet.mockRejectedValue(new Error("write error"));
    const service = await createService();

    await expect(
      service.linkThreadChannel("channel-orig", "thread-ch"),
    ).rejects.toThrow("write error");
  });
});

describe("AIService chat message truncation at MAX_MESSAGES", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function buildHistory(messageCount: number): string {
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: "System prompt" },
    ];
    for (let i = 1; i < messageCount; i++) {
      messages.push({
        role: i % 2 === 1 ? "user" : "assistant",
        content: `Message ${i}`,
      });
    }
    return JSON.stringify(messages);
  }

  it("truncates old messages when history exceeds 50", async () => {
    mockRedisGet.mockResolvedValue(buildHistory(51));
    mockChat.mockResolvedValue({ response: "Truncated", usage: null });
    mockRedisSet.mockResolvedValue(undefined);

    const service = await createService();
    await service.chat("channel-trunc", "New message");

    const saved = JSON.parse(mockRedisSet.mock.calls[0][1] as string) as Array<{
      role: string;
      content: string;
    }>;
    // 50 (truncated) + 1 (assistant response) = 51 saved
    expect(saved).toHaveLength(51);
    expect(saved[0].role).toBe("system");
    // Early messages removed: Message 1 & 2 truncated, Message 3 is now index 1
    expect(saved[1].content).toBe("Message 3");
    expect(saved[49].role).toBe("user");
    expect(saved[49].content).toBe("New message");
    expect(saved[50].role).toBe("assistant");
    expect(saved[50].content).toBe("Truncated");
  });

  it("does not truncate when total is exactly 50 before assistant", async () => {
    mockRedisGet.mockResolvedValue(buildHistory(49));
    mockChat.mockResolvedValue({ response: "Exact", usage: null });
    mockRedisSet.mockResolvedValue(undefined);

    const service = await createService();
    await service.chat("channel-exact", "New message");

    const saved = JSON.parse(mockRedisSet.mock.calls[0][1] as string) as Array<{
      role: string;
      content: string;
    }>;
    // 49 (from Redis) + 1 (user) + 1 (assistant) = 51, no truncation
    expect(saved).toHaveLength(51);
    expect(saved[1].content).toBe("Message 1");
    expect(saved[49].content).toBe("New message");
    expect(saved[50].content).toBe("Exact");
  });
});

describe("AIService chat invalid JSON in Redis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue("invalid json{");
    mockChat.mockResolvedValue({
      response: "Fallback response",
      usage: null,
    });
    mockRedisSet.mockResolvedValue(undefined);
  });

  it("falls back to system prompt when stored JSON is invalid", async () => {
    const service = await createService();
    await service.chat("channel-bad-json", "Hello");

    expect(mockChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("AIアシスタント"),
        }),
        expect.objectContaining({ role: "user", content: "Hello" }),
      ]),
    );
  });
});
