import { MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIService } from "@/ai/services/ai.service";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { ExternalServiceError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { ChatCommand } from "./chat.command";

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

function createInteraction(
  overrides: Partial<DomainInteraction> = {},
): DomainInteraction {
  return {
    id: "test-id",
    type: "command",
    channelId: "channel-1",
    userId: "user-1",
    commandName: "chat",
    options: { message: "Hello" },
    raw: { token: "test-token" },
    ...overrides,
  };
}

function createMockAIService(): AIService {
  return {
    chat: vi.fn(),
    resetConversation: vi.fn(),
    linkThreadChannel: vi.fn().mockResolvedValue(undefined),
  } as unknown as AIService;
}

function createMockDiscordClient(): DiscordClient {
  return {
    editInteractionResponse: vi.fn().mockResolvedValue("msg-123"),
    createThreadFromMessage: vi.fn().mockResolvedValue("thread-999"),
    sendMessage: vi.fn().mockResolvedValue(true),
    registerGuildCommands: vi.fn().mockResolvedValue(undefined),
    isThreadChannel: vi.fn().mockResolvedValue(false),
  } as unknown as DiscordClient;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("ChatCommand properties", () => {
  it("has name 'chat'", () => {
    const command = new ChatCommand(
      createMockAIService(),
      createMockDiscordClient(),
    );
    expect(command.name).toBe("chat");
  });

  it("has definition with description and options", () => {
    const command = new ChatCommand(
      createMockAIService(),
      createMockDiscordClient(),
    );
    expect(command.definition).toEqual({
      description: "AIとチャット",
      options: [
        {
          name: "message",
          description: "AIに送信するメッセージ",
          type: 3,
          required: true,
        },
      ],
    });
  });
});

describe("ChatCommand deferred response", () => {
  let aiService: AIService;
  let discordClient: DiscordClient;

  beforeEach(() => {
    aiService = createMockAIService();
    discordClient = createMockDiscordClient();
  });

  it("returns deferred response immediately", async () => {
    (aiService.chat as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok("AI response"),
    );
    const command = new ChatCommand(aiService, discordClient);

    const response = await command.execute(createInteraction());

    expect(response.type).toBe(5);
  });

  it("returns error message when interaction has no token", async () => {
    const command = new ChatCommand(aiService, discordClient);

    const response = await command.execute(createInteraction({ raw: {} }));

    expect(response.type).toBe(4);
    expect(response.data?.flags).toBe(MessageFlags.Ephemeral);
  });
});

describe("ChatCommand background input forwarding", () => {
  let aiService: AIService;
  let discordClient: DiscordClient;

  beforeEach(() => {
    aiService = createMockAIService();
    discordClient = createMockDiscordClient();
  });

  it("extracts message option and passes to AIService", async () => {
    (aiService.chat as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok("AI response"),
    );
    const command = new ChatCommand(aiService, discordClient);

    await command.execute(
      createInteraction({ options: { message: "Hello AI" } }),
    );
    await flushPromises();

    expect(aiService.chat).toHaveBeenCalledWith("channel-1", "Hello AI");
  });

  it("passes channelId to AIService", async () => {
    (aiService.chat as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok("AI response"),
    );
    const command = new ChatCommand(aiService, discordClient);

    await command.execute(createInteraction({ channelId: "ch-999" }));
    await flushPromises();

    expect(aiService.chat).toHaveBeenCalledWith("ch-999", expect.any(String));
  });
});

describe("ChatCommand thread creation flow", () => {
  let aiService: AIService;
  let discordClient: DiscordClient;

  beforeEach(() => {
    aiService = createMockAIService();
    discordClient = createMockDiscordClient();
  });

  it("edits response with user message then creates thread", async () => {
    (aiService.chat as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok("AI response"),
    );
    const command = new ChatCommand(aiService, discordClient);

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "> Hello",
    );
    expect(discordClient.createThreadFromMessage).toHaveBeenCalledWith(
      "channel-1",
      "msg-123",
      "Hello",
    );
    expect(discordClient.sendMessage).toHaveBeenCalledWith(
      "thread-999",
      "AI response",
    );
  });
});

describe("ChatCommand thread fallback", () => {
  let aiService: AIService;
  let discordClient: DiscordClient;

  beforeEach(() => {
    aiService = createMockAIService();
    discordClient = createMockDiscordClient();
  });

  it("sends AI response in channel when thread creation fails", async () => {
    (aiService.chat as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok("AI response"),
    );
    (
      discordClient.createThreadFromMessage as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    const command = new ChatCommand(aiService, discordClient);

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.sendMessage).toHaveBeenCalledWith(
      "channel-1",
      "AI response",
    );
  });
});

describe("ChatCommand error in thread", () => {
  let aiService: AIService;
  let discordClient: DiscordClient;

  beforeEach(() => {
    aiService = createMockAIService();
    discordClient = createMockDiscordClient();
  });

  it("sends error in thread when AIService fails", async () => {
    (aiService.chat as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new ExternalServiceError("Codex", "timeout")),
    );
    const command = new ChatCommand(aiService, discordClient);

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.sendMessage).toHaveBeenCalledWith(
      "thread-999",
      "エラーが発生しました。しばらくしてからお試しください。",
    );
  });
});

describe("ChatCommand inside existing thread", () => {
  let aiService: AIService;
  let discordClient: DiscordClient;

  beforeEach(() => {
    aiService = createMockAIService();
    discordClient = createMockDiscordClient();
    (
      discordClient.isThreadChannel as ReturnType<typeof vi.fn>
    ).mockResolvedValue(true);
  });

  it("skips thread creation and sends response directly", async () => {
    (aiService.chat as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok("AI response"),
    );
    const command = new ChatCommand(aiService, discordClient);

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.createThreadFromMessage).not.toHaveBeenCalled();
    expect(discordClient.sendMessage).toHaveBeenCalledWith(
      "channel-1",
      "AI response",
    );
  });
});
