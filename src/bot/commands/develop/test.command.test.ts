import { MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevelopService } from "@/ai/services/develop.service";
import type { ThreadState } from "@/infrastructure/redis/thread-state.types";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { AppError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { TestCommand } from "./test.command";

const mockValidateThreadCommand = vi.fn();
const mockSetRunning = vi.fn();
const mockExecuteTest = vi.fn();
const mockSetError = vi.fn();

vi.mock("@/ai/services/develop.service", () => ({
  DevelopService: vi.fn().mockImplementation(() => ({
    validateThreadCommand: mockValidateThreadCommand,
    setRunning: mockSetRunning,
    executeTest: mockExecuteTest,
    setError: mockSetError,
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

vi.mock("@/shared/utils/format", () => ({
  formatForDiscord: vi.fn((text: string) => text),
}));

function createInteraction(
  overrides: Partial<DomainInteraction> = {},
): DomainInteraction {
  return {
    id: "test-id",
    type: "command",
    channelId: "thread-1",
    userId: "user-1",
    commandName: "test",
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
    setRunning: mockSetRunning,
    executeTest: mockExecuteTest,
    setError: mockSetError,
  };
  const discordClient = discordClientOverride ?? createMockDiscordClient();
  const command = new TestCommand(
    developService as unknown as DevelopService,
    discordClient,
  );
  return { command, developService, discordClient };
}

describe("TestCommand properties", () => {
  it("has name 'test'", () => {
    const { command } = createCommand();
    expect(command.name).toBe("test");
  });

  it("has definition with description", () => {
    const { command } = createCommand();
    expect(command.definition).toEqual({
      description: "実装に対するテストを作成・実行",
    });
  });
});

describe("TestCommand deferred response", () => {
  let command: TestCommand;

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

describe("TestCommand thread validation", () => {
  let command: TestCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command } = createCommand());
  });

  it("validates thread with expected phase 'developed'", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockValidateThreadCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPhases: ["developed"],
      }),
    );
  });

  it("does nothing when validateThreadCommand returns error (wrong phase)", async () => {
    mockValidateThreadCommand.mockResolvedValue(
      err(new AppError("wrong phase", "VALIDATION_ERROR")),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockExecuteTest).not.toHaveBeenCalled();
  });
});

describe("TestCommand success flow - execution steps", () => {
  let command: TestCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command } = createCommand());
  });

  it("executes test and gets post-diff", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteTest.mockResolvedValue(
      ok({ response: "codex test response", diff: "diff content" }),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockSetRunning).toHaveBeenCalledWith("thread-1", state);
    expect(mockExecuteTest).toHaveBeenCalledWith("thread-1", state);
  });
});

describe("TestCommand success flow - diff response", () => {
  let command: TestCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("sends diff when post-diff is available", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteTest.mockResolvedValue(
      ok({ response: "codex test response", diff: "diff content" }),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "**テスト作成完了**\n\n```diff\ndiff content\n```",
    );
  });
});

describe("TestCommand success flow - empty diff fallback", () => {
  let command: TestCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("uses codex response text when post-diff is empty", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteTest.mockResolvedValue(
      ok({ response: "codex test response", diff: "" }),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "codex test response",
    );
  });
});

describe("TestCommand error when executeTest fails", () => {
  let command: TestCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("handles error when executeTest returns err", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteTest.mockResolvedValue(
      err(new AppError("diffの取得に失敗しました: diff failed", "GIT_ERROR")),
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

describe("TestCommand error handling - state update", () => {
  let command: TestCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command } = createCommand());
  });

  it("handles codex execution failure", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteTest.mockRejectedValue(
      new AppError("codex test failed", "CODEX_ERROR"),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockSetError).toHaveBeenCalledWith(
      "thread-1",
      state,
      "codex test failed",
    );
  });

  it("handles non-Error thrown value in codex execution", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteTest.mockRejectedValue("string error");

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockSetError).toHaveBeenCalledWith(
      "thread-1",
      state,
      "string error",
    );
  });
});

describe("TestCommand error handling - discord response", () => {
  let command: TestCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("sends error message to discord on codex failure", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteTest.mockRejectedValue(
      new AppError("codex test failed", "CODEX_ERROR"),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "テスト作成中にエラーが発生しました。しばらくしてから再試行してください。",
    );
  });
});
