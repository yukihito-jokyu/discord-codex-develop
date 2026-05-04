import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogInfo = vi.fn();
const mockLogError = vi.fn();

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: mockLogInfo,
    error: mockLogError,
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockPostChannelMessage = vi.fn();
const mockFetchChannelMessages = vi.fn();
const mockFetchChannelInfo = vi.fn();
const mockEncodeThreadId = vi
  .fn()
  .mockImplementation(({ channelId }: { channelId: string }) => channelId);

const mockAdapter = {
  postChannelMessage: mockPostChannelMessage,
  fetchChannelMessages: mockFetchChannelMessages,
  fetchChannelInfo: mockFetchChannelInfo,
  encodeThreadId: mockEncodeThreadId,
};

vi.mock("@chat-adapter/discord", () => ({
  createDiscordAdapter: vi.fn().mockReturnValue(mockAdapter),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { DiscordClient } = await import("./discord.client");

function createClient() {
  return new DiscordClient(mockAdapter as never, "test-token", "app-123");
}

describe("DiscordClient sendMessage success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true on success", async () => {
    mockPostChannelMessage.mockResolvedValue({});
    const client = createClient();

    const result = await client.sendMessage("ch-123", "Hello!");

    expect(result).toBe(true);
  });

  it("calls adapter postChannelMessage with encoded channel ID", async () => {
    mockPostChannelMessage.mockResolvedValue({});
    const client = createClient();

    await client.sendMessage("ch-123", "Hello!");

    expect(mockPostChannelMessage).toHaveBeenCalledWith("ch-123", "Hello!");
  });
});

describe("DiscordClient sendMessage error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false on adapter error", async () => {
    mockPostChannelMessage.mockRejectedValue(new Error("API error"));
    const client = createClient();

    const result = await client.sendMessage("ch-123", "Hello!");

    expect(result).toBe(false);
    expect(mockLogError).toHaveBeenCalledWith(
      { err: "API error", channelId: "ch-123" },
      "Failed to send Discord message",
    );
  });
});

describe("DiscordClient editInteractionResponse success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns message ID on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "msg-789" }),
    });
    const client = createClient();

    const result = await client.editInteractionResponse(
      "token-abc",
      "response content",
    );

    expect(result).toBe("msg-789");
  });

  it("returns null when response has no id", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const client = createClient();

    const result = await client.editInteractionResponse("token-abc", "content");

    expect(result).toBeNull();
  });
});

describe("DiscordClient editInteractionResponse error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null on API error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    });
    const client = createClient();

    const result = await client.editInteractionResponse("token-abc", "content");

    expect(result).toBeNull();
    expect(mockLogError).toHaveBeenCalledWith(
      { status: 404, body: "Not found" },
      "Failed to edit interaction response",
    );
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createClient();

    const result = await client.editInteractionResponse("token-abc", "content");

    expect(result).toBeNull();
    expect(mockLogError).toHaveBeenCalledWith(
      { err: "ECONNREFUSED" },
      "Interaction followup request failed",
    );
  });
});

describe("DiscordClient createThreadFromMessage success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns thread channel ID on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "thread-999" }),
    });
    const client = createClient();

    const result = await client.createThreadFromMessage(
      "ch-123",
      "msg-456",
      "AI Chat",
    );

    expect(result).toBe("thread-999");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/ch-123/messages/msg-456/threads",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bot test-token",
        },
        body: JSON.stringify({
          name: "AI Chat",
          auto_archive_duration: 60,
        }),
      },
    );
  });

  it("returns null when response has no id", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const client = createClient();

    const result = await client.createThreadFromMessage(
      "ch-123",
      "msg-456",
      "AI Chat",
    );

    expect(result).toBeNull();
  });
});

describe("DiscordClient createThreadFromMessage error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null on API error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
    });
    const client = createClient();

    const result = await client.createThreadFromMessage(
      "ch-123",
      "msg-456",
      "AI Chat",
    );

    expect(result).toBeNull();
    expect(mockLogError).toHaveBeenCalledWith(
      {
        status: 403,
        body: "Forbidden",
        channelId: "ch-123",
        messageId: "msg-456",
      },
      "Failed to create thread",
    );
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createClient();

    const result = await client.createThreadFromMessage(
      "ch-123",
      "msg-456",
      "AI Chat",
    );

    expect(result).toBeNull();
    expect(mockLogError).toHaveBeenCalledWith(
      { err: "ECONNREFUSED", channelId: "ch-123", messageId: "msg-456" },
      "Thread creation request failed",
    );
  });
});

describe("DiscordClient sendChannelMessage success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns message ID on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "msg-new" }),
    });
    const client = createClient();

    const result = await client.sendChannelMessage("ch-123", "Hello!");

    expect(result).toBe("msg-new");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/ch-123/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bot test-token",
        },
        body: JSON.stringify({ content: "Hello!" }),
      },
    );
  });

  it("returns null when response has no id", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const client = createClient();

    const result = await client.sendChannelMessage("ch-123", "Hello!");

    expect(result).toBeNull();
  });
});

describe("DiscordClient sendChannelMessage error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null on API error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
    });
    const client = createClient();

    const result = await client.sendChannelMessage("ch-123", "Hello!");

    expect(result).toBeNull();
    expect(mockLogError).toHaveBeenCalledWith(
      { status: 403, body: "Forbidden", channelId: "ch-123" },
      "Failed to send channel message",
    );
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createClient();

    const result = await client.sendChannelMessage("ch-123", "Hello!");

    expect(result).toBeNull();
    expect(mockLogError).toHaveBeenCalledWith(
      { err: "ECONNREFUSED", channelId: "ch-123" },
      "Channel message request failed",
    );
  });
});

describe("DiscordClient archiveThread success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true on success", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const client = createClient();

    const result = await client.archiveThread("thread-123");

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/thread-123",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bot test-token",
        },
        body: JSON.stringify({ archived: true }),
      },
    );
  });
});

describe("DiscordClient archiveThread error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false on API error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
    });
    const client = createClient();

    const result = await client.archiveThread("thread-123");

    expect(result).toBe(false);
    expect(mockLogError).toHaveBeenCalledWith(
      { status: 403, body: "Forbidden", threadId: "thread-123" },
      "Failed to archive thread",
    );
  });

  it("returns false on network error", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createClient();

    const result = await client.archiveThread("thread-123");

    expect(result).toBe(false);
    expect(mockLogError).toHaveBeenCalledWith(
      { err: "ECONNREFUSED", threadId: "thread-123" },
      "Thread archive request failed",
    );
  });
});

const testCommands = [
  {
    name: "ping",
    definition: { description: "Ping-Pong" },
    execute: vi.fn(),
  },
  {
    name: "chat",
    definition: {
      description: "Chat",
      options: [{ name: "msg", description: "msg", type: 3 }],
    },
    execute: vi.fn(),
  },
];

describe("DiscordClient registerGuildCommands success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers commands via PUT request", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const client = createClient();

    await client.registerGuildCommands("guild-456", testCommands);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://discord.com/api/v10/applications/app-123/guilds/guild-456/commands",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bot test-token",
        },
        body: JSON.stringify([
          { name: "ping", description: "Ping-Pong" },
          {
            name: "chat",
            description: "Chat",
            options: [{ name: "msg", description: "msg", type: 3 }],
          },
        ]),
      },
    );
  });

  it("filters out commands without definition", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const client = createClient();
    const commandsWithUndefined = [
      ...testCommands,
      { name: "no-def", execute: vi.fn() },
    ];

    await client.registerGuildCommands(
      "guild-456",
      commandsWithUndefined as typeof testCommands,
    );

    const callArgs = mockFetch.mock.calls[0][1];
    const body = JSON.parse(callArgs.body);
    expect(body).toHaveLength(2);
  });

  it("logs info on success", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const client = createClient();

    await client.registerGuildCommands("guild-456", testCommands);

    expect(mockLogInfo).toHaveBeenCalledWith(
      { guildId: "guild-456", count: 2 },
      "Guild commands registered",
    );
  });
});

describe("DiscordClient registerGuildCommands error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs error on API failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    const client = createClient();

    await client.registerGuildCommands("guild-456", testCommands);

    expect(mockLogError).toHaveBeenCalledWith(
      { status: 401, guildId: "guild-456" },
      "Failed to register guild commands",
    );
  });

  it("logs error on network failure", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createClient();

    await client.registerGuildCommands("guild-456", testCommands);

    expect(mockLogError).toHaveBeenCalledWith(
      { err: "ECONNREFUSED", guildId: "guild-456" },
      "Guild command registration request failed",
    );
  });
});

describe("DiscordClient getFirstMessage success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns content of the oldest message (smallest ID)", async () => {
    mockFetchChannelMessages.mockResolvedValue({
      messages: [
        { id: "200", text: "second message" },
        { id: "100", text: "first message" },
        { id: "300", text: "third message" },
      ],
    });
    const client = createClient();

    const result = await client.getFirstMessage("ch-123");

    expect(result).toBe("first message");
  });

  it("calls adapter fetchChannelMessages with encoded channel ID and limit", async () => {
    mockFetchChannelMessages.mockResolvedValue({
      messages: [{ id: "100", text: "hello" }],
    });
    const client = createClient();

    await client.getFirstMessage("ch-456");

    expect(mockFetchChannelMessages).toHaveBeenCalledWith("ch-456", {
      limit: 50,
    });
  });
});

describe("DiscordClient getFirstMessage boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when messages array is empty", async () => {
    mockFetchChannelMessages.mockResolvedValue({ messages: [] });
    const client = createClient();

    const result = await client.getFirstMessage("ch-123");

    expect(result).toBeNull();
  });

  it("returns content when only one message exists", async () => {
    mockFetchChannelMessages.mockResolvedValue({
      messages: [{ id: "100", text: "only message" }],
    });
    const client = createClient();

    const result = await client.getFirstMessage("ch-123");

    expect(result).toBe("only message");
  });

  it("returns null when oldest message text is undefined", async () => {
    mockFetchChannelMessages.mockResolvedValue({
      messages: [{ id: "100" }],
    });
    const client = createClient();

    const result = await client.getFirstMessage("ch-123");

    expect(result).toBeNull();
  });
});

describe("DiscordClient getFirstMessage error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null on adapter error", async () => {
    mockFetchChannelMessages.mockRejectedValue(new Error("API error"));
    const client = createClient();

    const result = await client.getFirstMessage("ch-123");

    expect(result).toBeNull();
    expect(mockLogError).toHaveBeenCalledWith(
      { err: "API error", channelId: "ch-123" },
      "Message fetch request failed",
    );
  });
});

describe("DiscordClient isThreadChannel returns true", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true for public thread (channelType 11)", async () => {
    mockFetchChannelInfo.mockResolvedValue({
      metadata: { channelType: 11 },
    });
    const client = createClient();

    const result = await client.isThreadChannel("ch-123");

    expect(result).toBe(true);
  });

  it("returns true for private thread (channelType 12)", async () => {
    mockFetchChannelInfo.mockResolvedValue({
      metadata: { channelType: 12 },
    });
    const client = createClient();

    const result = await client.isThreadChannel("ch-123");

    expect(result).toBe(true);
  });

  it("returns true for announcement thread (channelType 13)", async () => {
    mockFetchChannelInfo.mockResolvedValue({
      metadata: { channelType: 13 },
    });
    const client = createClient();

    const result = await client.isThreadChannel("ch-123");

    expect(result).toBe(true);
  });
});

describe("DiscordClient isThreadChannel returns false", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false for regular text channel (channelType 0)", async () => {
    mockFetchChannelInfo.mockResolvedValue({
      metadata: { channelType: 0 },
    });
    const client = createClient();

    const result = await client.isThreadChannel("ch-123");

    expect(result).toBe(false);
  });

  it("returns false when channelType is undefined", async () => {
    mockFetchChannelInfo.mockResolvedValue({
      metadata: {},
    });
    const client = createClient();

    const result = await client.isThreadChannel("ch-123");

    expect(result).toBe(false);
  });

  it("returns false for channelType 10 (boundary below thread range)", async () => {
    mockFetchChannelInfo.mockResolvedValue({
      metadata: { channelType: 10 },
    });
    const client = createClient();

    const result = await client.isThreadChannel("ch-123");

    expect(result).toBe(false);
  });

  it("returns false for channelType 14 (boundary above thread range)", async () => {
    mockFetchChannelInfo.mockResolvedValue({
      metadata: { channelType: 14 },
    });
    const client = createClient();

    const result = await client.isThreadChannel("ch-123");

    expect(result).toBe(false);
  });
});

describe("DiscordClient isThreadChannel error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false on adapter error", async () => {
    mockFetchChannelInfo.mockRejectedValue(new Error("API error"));
    const client = createClient();

    const result = await client.isThreadChannel("ch-123");

    expect(result).toBe(false);
    expect(mockLogError).toHaveBeenCalledWith(
      { err: "API error", channelId: "ch-123" },
      "Channel fetch request failed",
    );
  });
});
