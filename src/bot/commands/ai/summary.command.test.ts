import { describe, expect, it, vi } from "vitest";
import type { SummaryService } from "@/ai/services/summary.service";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { ExternalServiceError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { SummaryCommand } from "./summary.command";

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

function createMockInteraction(
  overrides?: Partial<DomainInteraction>,
): DomainInteraction {
  return {
    id: "interaction-1",
    type: "command",
    channelId: "channel-1",
    userId: "user-1",
    commandName: "summary",
    raw: { token: "token-1" },
    ...overrides,
  };
}

function createMockSummaryService(): SummaryService {
  return { summarize: vi.fn() } as unknown as SummaryService;
}

function createMockDiscordClient(): DiscordClient {
  return {
    getFirstMessage: vi.fn(),
    editInteractionResponse: vi.fn().mockResolvedValue("msg-1"),
  } as unknown as DiscordClient;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("SummaryCommand properties", () => {
  it("has name 'summary'", () => {
    const command = new SummaryCommand(
      createMockSummaryService(),
      createMockDiscordClient(),
    );
    expect(command.name).toBe("summary");
  });

  it("has definition with description", () => {
    const command = new SummaryCommand(
      createMockSummaryService(),
      createMockDiscordClient(),
    );
    expect(command.definition).toEqual({
      description: "フォーラム投稿のリンクを要約",
    });
  });
});

describe("SummaryCommand missing token", () => {
  it("returns error when interaction has no token", async () => {
    const command = new SummaryCommand(
      createMockSummaryService(),
      createMockDiscordClient(),
    );
    const response = await command.execute(createMockInteraction({ raw: {} }));

    expect(response.type).toBe(4);
    expect((response.data as { content: string }).content).toContain("エラー");
  });
});

describe("SummaryCommand no message", () => {
  it("replies error when first message not found", async () => {
    const discordClient = createMockDiscordClient();
    vi.mocked(discordClient.getFirstMessage).mockResolvedValue(null);

    const command = new SummaryCommand(
      createMockSummaryService(),
      discordClient,
    );
    await command.execute(createMockInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "token-1",
      expect.stringContaining("メッセージの取得に失敗"),
    );
  });
});

describe("SummaryCommand no url", () => {
  it("replies error when no url in message", async () => {
    const discordClient = createMockDiscordClient();
    vi.mocked(discordClient.getFirstMessage).mockResolvedValue(
      "no-url-message",
    );

    const command = new SummaryCommand(
      createMockSummaryService(),
      discordClient,
    );
    await command.execute(createMockInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "token-1",
      expect.stringContaining("リンクが見つかりません"),
    );
  });
});

describe("SummaryCommand success", () => {
  it("returns deferred and replies summary", async () => {
    const summaryService = createMockSummaryService();
    const discordClient = createMockDiscordClient();
    vi.mocked(discordClient.getFirstMessage).mockResolvedValue(
      "https://example.com/article1",
    );
    vi.mocked(summaryService.summarize).mockResolvedValue(ok("summary ok"));

    const command = new SummaryCommand(summaryService, discordClient);

    const response = await command.execute(createMockInteraction());
    expect(response.type).toBe(5);
    await flushPromises();

    expect(summaryService.summarize).toHaveBeenCalledWith([
      "https://example.com/article1",
    ]);
    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "token-1",
      "summary ok",
    );
  });
});

describe("SummaryCommand service error", () => {
  it("replies error when summarize fails", async () => {
    const summaryService = createMockSummaryService();
    const discordClient = createMockDiscordClient();
    vi.mocked(discordClient.getFirstMessage).mockResolvedValue(
      "https://example.com",
    );
    vi.mocked(summaryService.summarize).mockResolvedValue(
      err(new ExternalServiceError("Codex", "API error")),
    );

    const command = new SummaryCommand(summaryService, discordClient);
    await command.execute(createMockInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "token-1",
      expect.stringContaining("要約の生成に失敗"),
    );
  });
});

describe("SummaryCommand multiple urls", () => {
  it("extracts multiple URLs and passes them to summarize", async () => {
    const summaryService = createMockSummaryService();
    const discordClient = createMockDiscordClient();
    vi.mocked(discordClient.getFirstMessage).mockResolvedValue(
      "Check https://example.com/a and https://example.org/b",
    );
    vi.mocked(summaryService.summarize).mockResolvedValue(ok("summary ok"));

    const command = new SummaryCommand(summaryService, discordClient);
    await command.execute(createMockInteraction());
    await flushPromises();

    expect(summaryService.summarize).toHaveBeenCalledWith([
      "https://example.com/a",
      "https://example.org/b",
    ]);
  });
});

describe("SummaryCommand duplicate urls", () => {
  it("deduplicates identical URLs before passing to summarize", async () => {
    const summaryService = createMockSummaryService();
    const discordClient = createMockDiscordClient();
    vi.mocked(discordClient.getFirstMessage).mockResolvedValue(
      "https://example.com https://example.com",
    );
    vi.mocked(summaryService.summarize).mockResolvedValue(ok("summary ok"));

    const command = new SummaryCommand(summaryService, discordClient);
    await command.execute(createMockInteraction());
    await flushPromises();

    expect(summaryService.summarize).toHaveBeenCalledWith([
      "https://example.com",
    ]);
  });
});
