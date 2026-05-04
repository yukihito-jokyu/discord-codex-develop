import { MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevelopService } from "@/ai/services/develop.service";
import type { ThreadState } from "@/infrastructure/redis/thread-state.types";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { AppError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { CommitCommand } from "./commit.command";

const mockValidateThreadCommand = vi.fn();
const mockSetRunning = vi.fn();
const mockExecuteCommit = vi.fn();
const mockSetError = vi.fn();

vi.mock("@/ai/services/develop.service", () => ({
  DevelopService: vi.fn().mockImplementation(() => ({
    validateThreadCommand: mockValidateThreadCommand,
    setRunning: mockSetRunning,
    executeCommit: mockExecuteCommit,
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
    commandName: "commit",
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
    currentPhase: "tested",
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
    executeCommit: mockExecuteCommit,
    setError: mockSetError,
  };
  const discordClient = discordClientOverride ?? createMockDiscordClient();
  const command = new CommitCommand(
    developService as unknown as DevelopService,
    discordClient,
  );
  return { command, developService, discordClient };
}

describe("CommitCommand properties", () => {
  it("has name 'commit'", () => {
    const { command } = createCommand();
    expect(command.name).toBe("commit");
  });
});

describe("CommitCommand deferred response", () => {
  let command: CommitCommand;

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

describe("CommitCommand validates thread", () => {
  let command: CommitCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("requires phase 'tested'", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteCommit.mockResolvedValue(ok({ response: "commit response" }));

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockValidateThreadCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPhases: ["tested"],
      }),
    );
    expect(mockExecuteCommit).toHaveBeenCalled();
  });

  it("rejects when phase is wrong", async () => {
    mockValidateThreadCommand.mockResolvedValue(
      err(
        new AppError(
          "現在のフェーズが不正です (現在: developed, 期待: tested)",
          "VALIDATION_ERROR",
        ),
      ),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "現在のフェーズが不正です (現在: developed, 期待: tested)",
    );
    expect(mockExecuteCommit).not.toHaveBeenCalled();
  });
});

describe("CommitCommand success flow", () => {
  let command: CommitCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("executes commit and responds with formatted output", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteCommit.mockResolvedValue(ok({ response: "commit output" }));

    await command.execute(createInteraction());
    await flushPromises();

    // Verify executeCommit was called
    expect(mockExecuteCommit).toHaveBeenCalledWith("thread-1", state);

    // Responds with formatted output
    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      expect.any(String),
    );
  });
});

describe("CommitCommand executeCommit failure", () => {
  let command: CommitCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("returns error when executeCommit returns err", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteCommit.mockResolvedValue(
      err(new AppError("diffの取得に失敗しました: diff failed", "DIFF_ERROR")),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockSetError).toHaveBeenCalledWith(
      "thread-1",
      state,
      "diffの取得に失敗しました: diff failed",
    );

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "diffの取得に失敗しました: diff failed",
    );
  });
});

describe("CommitCommand codex failure", () => {
  let command: CommitCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("handles error when codex throws", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteCommit.mockRejectedValue(new Error("codex crashed"));

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "コミット中にエラーが発生しました。しばらくしてから再試行してください。",
    );

    expect(mockSetError).toHaveBeenCalledWith(
      "thread-1",
      state,
      "codex crashed",
    );
  });
});
