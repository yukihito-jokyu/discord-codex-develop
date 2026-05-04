import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIService } from "@/ai/services/ai.service";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { GatewayEvent } from "@/sdk/discord/types/gateway";

const mockLogInfo = vi.fn();
const mockLogError = vi.fn();
const mockLogWarn = vi.fn();
const mockLogDebug = vi.fn();

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: mockLogInfo,
    error: mockLogError,
    warn: mockLogWarn,
    debug: mockLogDebug,
  }),
}));

const mockChat = vi.fn();
const mockSendMessage = vi.fn();
const mockCreateThreadFromMessage = vi.fn();
const mockIsThreadChannel = vi.fn();
const mockLinkThreadChannel = vi.fn();

vi.mock("@/ai/services/ai.service", () => ({
  AIService: vi.fn().mockImplementation(() => ({
    chat: mockChat,
    linkThreadChannel: mockLinkThreadChannel,
  })),
}));

vi.mock("@/sdk/discord/discord.client", () => ({
  DiscordClient: vi.fn().mockImplementation(() => ({
    sendMessage: mockSendMessage,
    createThreadFromMessage: mockCreateThreadFromMessage,
    isThreadChannel: mockIsThreadChannel,
  })),
}));

const { MessageHandler } = await import("./message.handler");

function makeMentionEvent(
  overrides: Record<string, unknown> = {},
): GatewayEvent {
  return {
    type: "GATEWAY_MESSAGE_CREATE",
    timestamp: Date.now(),
    data: {
      id: "msg-1",
      channel_id: "ch-1",
      content: "<@app-id> hello",
      author: { id: "user-1", username: "testuser" },
      mentions: [{ id: "app-id", username: "testbot" }],
      ...overrides,
    },
  };
}

function createMockDeps() {
  const aiService = {
    chat: mockChat,
    linkThreadChannel: mockLinkThreadChannel,
  } as unknown as AIService;
  const discordClient = {
    sendMessage: mockSendMessage,
    createThreadFromMessage: mockCreateThreadFromMessage,
    isThreadChannel: mockIsThreadChannel,
  } as unknown as DiscordClient;
  return { aiService, discordClient };
}

describe("MessageHandler thread creation", () => {
  let handler: InstanceType<typeof MessageHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    const { aiService, discordClient } = createMockDeps();
    handler = new MessageHandler(aiService, discordClient, "app-id");
  });

  it("creates thread and sends response in thread", async () => {
    mockChat.mockResolvedValue({ ok: true, value: "AI response here" });
    mockIsThreadChannel.mockResolvedValue(false);
    mockCreateThreadFromMessage.mockResolvedValue("thread-1");

    await handler.handleGatewayEvent(makeMentionEvent());

    expect(mockCreateThreadFromMessage).toHaveBeenCalledWith(
      "ch-1",
      "msg-1",
      "hello",
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      "thread-1",
      "AI response here",
    );
    expect(mockLinkThreadChannel).toHaveBeenCalledWith("ch-1", "thread-1");
  });

  it("sends response in channel when thread creation fails", async () => {
    mockChat.mockResolvedValue({ ok: true, value: "AI response" });
    mockIsThreadChannel.mockResolvedValue(false);
    mockCreateThreadFromMessage.mockResolvedValue(null);

    await handler.handleGatewayEvent(makeMentionEvent());

    expect(mockSendMessage).toHaveBeenCalledWith("ch-1", "AI response");
    expect(mockLinkThreadChannel).not.toHaveBeenCalled();
  });
});

describe("MessageHandler in existing thread", () => {
  let handler: InstanceType<typeof MessageHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    const { aiService, discordClient } = createMockDeps();
    handler = new MessageHandler(aiService, discordClient, "app-id");
  });

  it("sends response in channel when already in thread", async () => {
    mockChat.mockResolvedValue({ ok: true, value: "AI response" });
    mockIsThreadChannel.mockResolvedValue(true);

    await handler.handleGatewayEvent(makeMentionEvent());

    expect(mockCreateThreadFromMessage).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith("ch-1", "AI response");
  });

  it("strips nickname format mention from content", async () => {
    mockChat.mockResolvedValue({ ok: true, value: "response" });
    mockIsThreadChannel.mockResolvedValue(true);

    const event = makeMentionEvent({
      content: "<@!app-id> how are you?",
    });

    await handler.handleGatewayEvent(event);

    expect(mockChat).toHaveBeenCalledWith("ch-1", "how are you?");
  });
});

describe("MessageHandler logging", () => {
  let handler: InstanceType<typeof MessageHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    const { aiService, discordClient } = createMockDeps();
    handler = new MessageHandler(aiService, discordClient, "app-id");
  });

  it("logs received mention message with user input", async () => {
    mockChat.mockResolvedValue({ ok: true, value: "AI response" });
    mockIsThreadChannel.mockResolvedValue(true);

    await handler.handleGatewayEvent(makeMentionEvent());

    expect(mockLogInfo).toHaveBeenCalledWith(
      {
        channelId: "ch-1",
        userId: "user-1",
        userMessage: "hello",
      },
      "Received mention message",
    );
  });

  it("logs AI response when sent successfully", async () => {
    mockChat.mockResolvedValue({ ok: true, value: "AI response here" });
    mockIsThreadChannel.mockResolvedValue(true);

    await handler.handleGatewayEvent(makeMentionEvent());

    expect(mockLogInfo).toHaveBeenCalledWith(
      {
        channelId: "ch-1",
        responseLength: 16,
        responsePreview: "AI response here",
      },
      "Sending AI response",
    );
  });
});

describe("MessageHandler filtering", () => {
  let handler: InstanceType<typeof MessageHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    const { aiService, discordClient } = createMockDeps();
    handler = new MessageHandler(aiService, discordClient, "app-id");
  });

  it("ignores non-mention events", async () => {
    const event = makeMentionEvent();
    (event.data as Record<string, unknown>).mentions = [];

    await handler.handleGatewayEvent(event);

    expect(mockChat).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("ignores bot messages", async () => {
    const event = makeMentionEvent();
    (event.data as Record<string, unknown>).author = {
      id: "bot-1",
      username: "testbot",
      bot: true,
    };

    await handler.handleGatewayEvent(event);

    expect(mockChat).not.toHaveBeenCalled();
  });

  it("ignores non-MESSAGE_CREATE events", async () => {
    const event: GatewayEvent = {
      type: "GATEWAY_MESSAGE_REACTION_ADD",
      timestamp: Date.now(),
      data: {},
    };

    await handler.handleGatewayEvent(event);

    expect(mockChat).not.toHaveBeenCalled();
  });

  it("ignores empty message after stripping mention", async () => {
    const event = makeMentionEvent({
      content: "<@app-id>",
    });

    await handler.handleGatewayEvent(event);

    expect(mockChat).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      { channelId: "ch-1" },
      "Empty message after stripping mention",
    );
  });
});

describe("MessageHandler errors", () => {
  let handler: InstanceType<typeof MessageHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    const { aiService, discordClient } = createMockDeps();
    handler = new MessageHandler(aiService, discordClient, "app-id");
  });

  it("logs error and sends error message when AIService fails", async () => {
    mockChat.mockResolvedValue({
      ok: false,
      error: { message: "Codex error" },
    });
    mockIsThreadChannel.mockResolvedValue(true);

    await handler.handleGatewayEvent(makeMentionEvent());

    expect(mockLogError).toHaveBeenCalledWith(
      { error: "Codex error", channelId: "ch-1" },
      "AI service error",
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      "ch-1",
      "エラーが発生しました。しばらくしてからお試しください。",
    );
  });

  it("logs error when sendMessage returns false", async () => {
    mockChat.mockResolvedValue({ ok: true, value: "AI response" });
    mockIsThreadChannel.mockResolvedValue(true);
    mockSendMessage.mockResolvedValue(false);

    await handler.handleGatewayEvent(makeMentionEvent());

    expect(mockLogError).toHaveBeenCalledWith(
      { channelId: "ch-1" },
      "Failed to send AI response",
    );
  });

  it("logs warning when message data extraction fails", async () => {
    const event: GatewayEvent = {
      type: "GATEWAY_MESSAGE_CREATE",
      timestamp: Date.now(),
      data: {
        mentions: [{ id: "app-id", username: "testbot" }],
      },
    };

    await handler.handleGatewayEvent(event);

    expect(mockLogWarn).toHaveBeenCalledWith(
      { error: expect.any(String) },
      "Failed to extract message data",
    );
    expect(mockChat).not.toHaveBeenCalled();
  });
});
