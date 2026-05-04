import { MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevelopService } from "@/ai/services/develop.service";
import type { ThreadState } from "@/infrastructure/redis/thread-state.types";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { AppError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { PrCommand } from "./pr.command";

const mockValidateThreadCommand = vi.fn();
const mockSetRunning = vi.fn();
const mockExecutePr = vi.fn();
const mockSetError = vi.fn();

vi.mock("@/ai/services/develop.service", () => ({
  DevelopService: vi.fn().mockImplementation(() => ({
    validateThreadCommand: mockValidateThreadCommand,
    setRunning: mockSetRunning,
    executePr: mockExecutePr,
    setError: mockSetError,
  })),
}));

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/shared/utils/format", () => ({
  formatForDiscord: vi.fn((text: string) => text),
}));

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createInteraction(
  overrides: Partial<DomainInteraction> = {},
): DomainInteraction {
  return {
    id: "test-id",
    type: "command",
    channelId: "thread-1",
    userId: "user-1",
    commandName: "pr",
    options: {},
    raw: { token: "test-token" },
    ...overrides,
  };
}

function createMockThreadState(
  overrides: Partial<ThreadState> = {},
): ThreadState {
  return {
    initiatedBy: "user-1",
    issueNumber: 15,
    repo: "test-repo",
    branch: "feature/15",
    workspacePath: "/workspace/test-repo",
    currentPhase: "committed",
    subStage: "idle",
    lastError: null,
    planOutput: null,
    ...overrides,
  };
}

function createMockDiscordClient(): DiscordClient {
  return {
    editInteractionResponse: vi.fn().mockResolvedValue("msg-123"),
    isThreadChannel: vi.fn().mockResolvedValue(true),
  } as unknown as DiscordClient;
}

function createCommand(discordClientOverride?: DiscordClient) {
  const developService = {
    validateThreadCommand: mockValidateThreadCommand,
    setRunning: mockSetRunning,
    executePr: mockExecutePr,
    setError: mockSetError,
  };
  const discordClient = discordClientOverride ?? createMockDiscordClient();
  const command = new PrCommand(
    developService as unknown as DevelopService,
    discordClient,
  );
  return { command, developService, discordClient };
}

describe("PrCommand properties", () => {
  it("has name 'pr'", () => {
    const { command } = createCommand();
    expect(command.name).toBe("pr");
  });
});

describe("PrCommand deferred response", () => {
  let command: PrCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command } = createCommand());
  });

  it("returns deferred response immediately", async () => {
    const response = await command.execute(createInteraction());

    expect(response.type).toBe(5);
  });

  it("returns error message when interaction has no token", async () => {
    const response = await command.execute(createInteraction({ raw: {} }));

    expect(response.type).toBe(4);
    expect(response.data?.flags).toBe(MessageFlags.Ephemeral);
  });
});

describe("PrCommand validates thread", () => {
  let command: PrCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("requires phase 'committed'", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecutePr.mockResolvedValue(
      ok({ prUrl: "https://github.com/o/r/pull/1" }),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockValidateThreadCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPhases: ["committed"],
      }),
    );
    expect(mockExecutePr).toHaveBeenCalled();
  });

  it("rejects when phase is wrong", async () => {
    mockValidateThreadCommand.mockResolvedValue(
      err(
        new AppError(
          "現在のフェーズが不正です (現在: tested, 期待: committed)",
          "VALIDATION_ERROR",
        ),
      ),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "現在のフェーズが不正です (現在: tested, 期待: committed)",
    );
    expect(mockExecutePr).not.toHaveBeenCalled();
  });
});

describe("PrCommand success flow", () => {
  let command: PrCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("executes PR and responds with PR URL", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecutePr.mockResolvedValue(
      ok({ prUrl: "https://github.com/o/r/pull/1" }),
    );

    await command.execute(createInteraction());
    await flushPromises();

    // Verify executePr was called
    expect(mockExecutePr).toHaveBeenCalledWith("thread-1", state);

    // Responds with PR URL
    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      expect.stringContaining("https://github.com/o/r/pull/1"),
    );
  });
});

describe("PrCommand PR creation failure", () => {
  let command: PrCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("handles error when PR creation fails", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecutePr.mockResolvedValue(
      err(new AppError("PR already exists", "PR_ERROR")),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockSetError).toHaveBeenCalledWith(
      "thread-1",
      state,
      "PR already exists",
    );

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "PRの作成に失敗しました: PR already exists",
    );
  });
});

describe("PrCommand codex push failure", () => {
  let command: PrCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("handles error when codex push fails", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecutePr.mockRejectedValue(new Error("push failed"));

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "PR作成中にエラーが発生しました。しばらくしてから再試行してください。",
    );

    expect(mockSetError).toHaveBeenCalledWith("thread-1", state, "push failed");
  });
});
