import { MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexExecClient } from "@/ai/client/codex-exec.client";
import type { RedisClient } from "@/infrastructure/redis/redis.client";
import type { ThreadState } from "@/infrastructure/redis/thread-state.types";
import type { WorkspaceManager } from "@/infrastructure/workspace/workspace.manager";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { AppError } from "@/shared/types/errors";
import { ok } from "@/shared/types/result";
import { DevelopCommand } from "./develop.command";
import { executeCodexOrResume, validateThreadCommand } from "./validate";

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("@/ai/prompts/templates/develop-impl", () => ({
  buildDevelopImplPrompt: vi.fn().mockReturnValue("built-develop-prompt"),
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
    commandName: "develop",
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
    currentPhase: "planned",
    subStage: "idle",
    lastError: null,
    planOutput: "plan text",
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

describe("DevelopCommand properties", () => {
  it("has name 'develop'", () => {
    const command = new DevelopCommand({
      redis: createMockRedis(),
      codexExec: createMockCodexExec(),
      workspace: createMockWorkspace(),
      discordClient: createMockDiscordClient(),
    });
    expect(command.name).toBe("develop");
  });

  it("has definition with description", () => {
    const command = new DevelopCommand({
      redis: createMockRedis(),
      codexExec: createMockCodexExec(),
      workspace: createMockWorkspace(),
      discordClient: createMockDiscordClient(),
    });
    expect(command.definition).toEqual({
      description: "計画に基づいてコードを実装",
    });
  });
});

describe("DevelopCommand deferred response", () => {
  let command: DevelopCommand;

  beforeEach(() => {
    command = new DevelopCommand({
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

describe("DevelopCommand thread validation", () => {
  let command: DevelopCommand;

  beforeEach(() => {
    command = new DevelopCommand({
      redis: createMockRedis(),
      codexExec: createMockCodexExec(),
      workspace: createMockWorkspace(),
      discordClient: createMockDiscordClient(),
    });
    vi.restoreAllMocks();
  });

  it("validates thread with expected phase 'planned'", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(validateThreadCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPhases: ["planned"],
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

describe("DevelopCommand success flow - full execution", () => {
  let command: DevelopCommand;
  let redis: RedisClient;
  let codexExec: CodexExecClient;
  let workspace: WorkspaceManager;
  let discordClient: DiscordClient;

  beforeEach(() => {
    redis = createMockRedis();
    codexExec = createMockCodexExec();
    workspace = createMockWorkspace();
    discordClient = createMockDiscordClient();
    command = new DevelopCommand({
      redis,
      codexExec,
      workspace,
      discordClient,
    });
    vi.restoreAllMocks();
  });

  it("builds prompt, executes codex, gets diff, updates phase to 'developed'", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      threadId: "codex-thread-1",
      response: "codex response text",
      usage: null,
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(executeCodexOrResume).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "develop",
        prompt: "built-develop-prompt",
        cwd: "/workspace/issue-42",
        sandboxMode: "write",
      }),
    );

    expect(workspace.getDiff).toHaveBeenCalledWith("/workspace/issue-42");
    expect(redis.compareAndSwapPhase).toHaveBeenCalledWith(
      "thread-1",
      "planned",
      "developed",
    );
    expect(redis.saveThreadState).toHaveBeenCalledWith("thread-1", state);
  });
});

describe("DevelopCommand success flow - response content", () => {
  let command: DevelopCommand;
  let workspace: WorkspaceManager;
  let discordClient: DiscordClient;

  beforeEach(() => {
    workspace = createMockWorkspace();
    discordClient = createMockDiscordClient();
    command = new DevelopCommand({
      redis: createMockRedis(),
      codexExec: createMockCodexExec(),
      workspace,
      discordClient,
    });
    vi.restoreAllMocks();
  });

  it("sends diff when diff is available", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      threadId: "codex-thread-1",
      response: "codex response text",
      usage: null,
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "**実装完了**\n\n```diff\ndiff content\n```",
    );
  });

  it("uses codex response text when diff is empty", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      threadId: "codex-thread-1",
      response: "codex response text",
      usage: null,
    });
    (workspace.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue(ok(""));

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "codex response text",
    );
  });
});

describe("DevelopCommand error handling", () => {
  let command: DevelopCommand;
  let redis: RedisClient;

  beforeEach(() => {
    redis = createMockRedis();
    command = new DevelopCommand({
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
      new AppError("codex failed", "CODEX_ERROR"),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(redis.saveThreadState).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        subStage: "idle",
        lastError: "codex failed",
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

describe("DevelopCommand error handling - discord response", () => {
  let command: DevelopCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    discordClient = createMockDiscordClient();
    command = new DevelopCommand({
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
      new AppError("codex failed", "CODEX_ERROR"),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "実装中にエラーが発生しました。しばらくしてから再試行してください。",
    );
  });
});
