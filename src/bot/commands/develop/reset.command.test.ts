import { MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevelopService } from "@/ai/services/develop.service";
import type {
  Phase,
  ThreadState,
} from "@/infrastructure/redis/thread-state.types";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { AppError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { ResetCommand } from "./reset.command";

const mockValidateThreadCommand = vi.fn();
const mockDiscardChanges = vi.fn();

vi.mock("@/ai/services/develop.service", () => ({
  DevelopService: vi.fn().mockImplementation(() => ({
    validateThreadCommand: mockValidateThreadCommand,
    discardChanges: mockDiscardChanges,
  })),
}));

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

function createInteraction(
  overrides: Partial<DomainInteraction> = {},
): DomainInteraction {
  return {
    id: "test-id",
    type: "command",
    channelId: "thread-1",
    userId: "user-1",
    commandName: "reset",
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
    issueNumber: 42,
    repo: "owner/repo",
    branch: "feature/42",
    workspacePath: "/workspace/issue-42",
    currentPhase: "developed",
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
    sendMessage: vi.fn().mockResolvedValue(true),
  } as unknown as DiscordClient;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createCommand(discordClientOverride?: DiscordClient) {
  const developService = {
    validateThreadCommand: mockValidateThreadCommand,
    discardChanges: mockDiscardChanges,
  };
  const discordClient = discordClientOverride ?? createMockDiscordClient();
  const command = new ResetCommand(
    developService as unknown as DevelopService,
    discordClient,
  );
  return { command, developService, discordClient };
}

describe("ResetCommand properties", () => {
  it("has name 'reset'", () => {
    const { command } = createCommand();
    expect(command.name).toBe("reset");
  });

  it("has definition with description", () => {
    const { command } = createCommand();
    expect(command.definition).toEqual({
      description: "ワークスペースの変更を破棄",
    });
  });
});

describe("ResetCommand deferred response", () => {
  let command: ResetCommand;

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

describe("ResetCommand thread validation", () => {
  let command: ResetCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command } = createCommand());
  });

  it("accepts any phase", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockDiscardChanges.mockResolvedValue(ok(undefined));

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockValidateThreadCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPhases: [
          "init",
          "planned",
          "developed",
          "tested",
          "committed",
          "completed",
        ] as Phase[],
      }),
    );
  });

  it("does nothing when validateThreadCommand returns error", async () => {
    mockValidateThreadCommand.mockResolvedValue(
      err(new AppError("validation failed", "VALIDATION_ERROR")),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockDiscardChanges).not.toHaveBeenCalled();
  });
});

describe("ResetCommand success flow", () => {
  let command: ResetCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("discards changes and responds with success message", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockDiscardChanges.mockResolvedValue(ok(undefined));

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockDiscardChanges).toHaveBeenCalledWith(state);

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "ワークスペースの変更を破棄しました。",
    );
  });
});

describe("ResetCommand error when discard fails", () => {
  let command: ResetCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("responds with error message when discardChanges fails", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockDiscardChanges.mockResolvedValue(
      err(new AppError("git checkout failed", "GIT_ERROR")),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "変更の破棄に失敗しました: git checkout failed",
    );
  });
});
