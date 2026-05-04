import { MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexExecClient } from "@/ai/client/codex-exec.client";
import type { RedisClient } from "@/infrastructure/redis/redis.client";
import type { ThreadState } from "@/infrastructure/redis/thread-state.types";
import type { WorkspaceManager } from "@/infrastructure/workspace/workspace.manager";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { AppError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { TestCommand } from "./test.command";
import { executeCodexOrResume, validateThreadCommand } from "./validate";

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("@/ai/prompts/templates/develop-test", () => ({
  buildDevelopTestPrompt: vi.fn().mockReturnValue("built-test-prompt"),
}));

vi.mock("./validate", () => ({
  validateThreadCommand: vi.fn(),
  executeCodexOrResume: vi.fn(),
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

function createMockRedis(): RedisClient {
  return {
    getThreadState: vi.fn().mockResolvedValue(createMockThreadState()),
    saveThreadState: vi.fn().mockResolvedValue(undefined),
    compareAndSwapPhase: vi.fn().mockResolvedValue(true),
    getCodexThread: vi.fn().mockResolvedValue(null),
    saveCodexThread: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisClient;
}

function createMockCodexExec(): CodexExecClient {
  return {
    startThread: vi.fn().mockResolvedValue({
      threadId: "codex-thread-1",
      response: "response text",
      usage: null,
    }),
    resumeThread: vi.fn().mockResolvedValue({
      threadId: "codex-thread-1",
      response: "response text",
      usage: null,
    }),
  } as unknown as CodexExecClient;
}

function createMockWorkspace(): WorkspaceManager {
  return {
    getDiff: vi.fn().mockResolvedValue(ok("diff content")),
  } as unknown as WorkspaceManager;
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

describe("TestCommand properties", () => {
  it("has name 'test'", () => {
    const command = new TestCommand({
      redis: createMockRedis(),
      codexExec: createMockCodexExec(),
      workspace: createMockWorkspace(),
      discordClient: createMockDiscordClient(),
    });
    expect(command.name).toBe("test");
  });

  it("has definition with description", () => {
    const command = new TestCommand({
      redis: createMockRedis(),
      codexExec: createMockCodexExec(),
      workspace: createMockWorkspace(),
      discordClient: createMockDiscordClient(),
    });
    expect(command.definition).toEqual({
      description: "実装に対するテストを作成・実行",
    });
  });
});

describe("TestCommand deferred response", () => {
  let command: TestCommand;

  beforeEach(() => {
    command = new TestCommand({
      redis: createMockRedis(),
      codexExec: createMockCodexExec(),
      workspace: createMockWorkspace(),
      discordClient: createMockDiscordClient(),
    });
    vi.restoreAllMocks();
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
    command = new TestCommand({
      redis: createMockRedis(),
      codexExec: createMockCodexExec(),
      workspace: createMockWorkspace(),
      discordClient: createMockDiscordClient(),
    });
    vi.restoreAllMocks();
  });

  it("validates thread with expected phase 'developed'", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(validateThreadCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPhases: ["developed"],
      }),
    );
  });

  it("does nothing when validateThreadCommand returns null (wrong phase)", async () => {
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockClear();

    await command.execute(createInteraction());
    await flushPromises();

    expect(executeCodexOrResume).not.toHaveBeenCalled();
  });
});

describe("TestCommand success flow - execution steps", () => {
  let command: TestCommand;
  let redis: RedisClient;
  let workspace: WorkspaceManager;

  beforeEach(() => {
    redis = createMockRedis();
    workspace = createMockWorkspace();
    command = new TestCommand({
      redis,
      codexExec: createMockCodexExec(),
      workspace,
      discordClient: createMockDiscordClient(),
    });
    vi.restoreAllMocks();
  });

  it("gets diff, builds prompt, executes codex, gets post-diff, updates phase to 'tested'", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      threadId: "codex-thread-1",
      response: "codex test response",
      usage: null,
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(workspace.getDiff).toHaveBeenCalledWith("/workspace/issue-42");
    expect(workspace.getDiff).toHaveBeenCalledTimes(2);

    expect(executeCodexOrResume).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "test",
        prompt: "built-test-prompt",
        cwd: "/workspace/issue-42",
        sandboxMode: "write",
      }),
    );

    expect(redis.compareAndSwapPhase).toHaveBeenCalledWith(
      "thread-1",
      "developed",
      "tested",
    );
    expect(redis.saveThreadState).toHaveBeenCalledWith("thread-1", state);
  });
});

describe("TestCommand success flow - diff response", () => {
  let command: TestCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    discordClient = createMockDiscordClient();
    command = new TestCommand({
      redis: createMockRedis(),
      codexExec: createMockCodexExec(),
      workspace: createMockWorkspace(),
      discordClient,
    });
    vi.restoreAllMocks();
  });

  it("sends diff when post-diff is available", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      threadId: "codex-thread-1",
      response: "codex test response",
      usage: null,
    });

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
  let workspace: WorkspaceManager;
  let discordClient: DiscordClient;

  beforeEach(() => {
    workspace = createMockWorkspace();
    discordClient = createMockDiscordClient();
    command = new TestCommand({
      redis: createMockRedis(),
      codexExec: createMockCodexExec(),
      workspace,
      discordClient,
    });
    vi.restoreAllMocks();
  });

  it("uses codex response text when post-diff is empty", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      threadId: "codex-thread-1",
      response: "codex test response",
      usage: null,
    });
    (workspace.getDiff as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(ok("initial diff"))
      .mockResolvedValueOnce(ok(""));

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "codex test response",
    );
  });
});

describe("TestCommand error when diff fetch fails", () => {
  let redis: RedisClient;
  let discordClient: DiscordClient;

  beforeEach(() => {
    redis = createMockRedis();
    discordClient = createMockDiscordClient();
    vi.restoreAllMocks();
  });

  it("handles error when initial diff fetch fails", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });

    const workspace = createMockWorkspace();
    (workspace.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new AppError("diff failed", "GIT_ERROR")),
    );
    const cmd = new TestCommand({
      redis,
      codexExec: createMockCodexExec(),
      workspace,
      discordClient,
    });

    await cmd.execute(createInteraction());
    await flushPromises();

    expect(redis.saveThreadState).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        subStage: "idle",
        lastError: "diffの取得に失敗しました: diff failed",
      }),
    );
  });
});

describe("TestCommand error when diff fetch fails - discord response", () => {
  let command: TestCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    discordClient = createMockDiscordClient();
    const workspace = createMockWorkspace();
    (workspace.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new AppError("diff failed", "GIT_ERROR")),
    );
    command = new TestCommand({
      redis: createMockRedis(),
      codexExec: createMockCodexExec(),
      workspace,
      discordClient,
    });
    vi.restoreAllMocks();
  });

  it("sends error message to discord when diff fetch fails", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "テスト作成中にエラーが発生しました。しばらくしてから再試行してください。",
    );
  });
});

describe("TestCommand error handling - state update", () => {
  let command: TestCommand;
  let redis: RedisClient;

  beforeEach(() => {
    redis = createMockRedis();
    command = new TestCommand({
      redis,
      codexExec: createMockCodexExec(),
      workspace: createMockWorkspace(),
      discordClient: createMockDiscordClient(),
    });
    vi.restoreAllMocks();
  });

  it("handles codex execution failure", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AppError("codex test failed", "CODEX_ERROR"),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(redis.saveThreadState).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        subStage: "idle",
        lastError: "codex test failed",
      }),
    );
  });

  it("handles non-Error thrown value in codex execution", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockRejectedValue(
      "string error",
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(redis.saveThreadState).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        lastError: "string error",
      }),
    );
  });
});

describe("TestCommand error handling - discord response", () => {
  let command: TestCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    discordClient = createMockDiscordClient();
    command = new TestCommand({
      redis: createMockRedis(),
      codexExec: createMockCodexExec(),
      workspace: createMockWorkspace(),
      discordClient,
    });
    vi.restoreAllMocks();
  });

  it("sends error message to discord on codex failure", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockRejectedValue(
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
