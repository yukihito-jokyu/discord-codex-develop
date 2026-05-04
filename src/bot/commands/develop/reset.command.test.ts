import { MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RedisClient } from "@/infrastructure/redis/redis.client";
import type {
  Phase,
  ThreadState,
} from "@/infrastructure/redis/thread-state.types";
import type { WorkspaceManager } from "@/infrastructure/workspace/workspace.manager";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { AppError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { ResetCommand } from "./reset.command";
import { validateThreadCommand } from "./validate";

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("./validate", () => ({
  validateThreadCommand: vi.fn(),
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

function createMockRedis(): RedisClient {
  return {
    getThreadState: vi.fn().mockResolvedValue(createMockThreadState()),
    saveThreadState: vi.fn().mockResolvedValue(undefined),
    compareAndSwapPhase: vi.fn().mockResolvedValue(true),
    getCodexThread: vi.fn().mockResolvedValue(null),
    saveCodexThread: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisClient;
}

function createMockWorkspace(): WorkspaceManager {
  return {
    discardChanges: vi.fn().mockResolvedValue(ok(undefined)),
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

describe("ResetCommand properties", () => {
  it("has name 'reset'", () => {
    const command = new ResetCommand({
      redis: createMockRedis(),
      workspace: createMockWorkspace(),
      discordClient: createMockDiscordClient(),
    });
    expect(command.name).toBe("reset");
  });

  it("has definition with description", () => {
    const command = new ResetCommand({
      redis: createMockRedis(),
      workspace: createMockWorkspace(),
      discordClient: createMockDiscordClient(),
    });
    expect(command.definition).toEqual({
      description: "ワークスペースの変更を破棄",
    });
  });
});

describe("ResetCommand deferred response", () => {
  let command: ResetCommand;

  beforeEach(() => {
    command = new ResetCommand({
      redis: createMockRedis(),
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

describe("ResetCommand thread validation", () => {
  let command: ResetCommand;

  beforeEach(() => {
    command = new ResetCommand({
      redis: createMockRedis(),
      workspace: createMockWorkspace(),
      discordClient: createMockDiscordClient(),
    });
    vi.restoreAllMocks();
  });

  it("accepts any phase", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(validateThreadCommand).toHaveBeenCalledWith(
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

  it("does nothing when validateThreadCommand returns null", async () => {
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await command.execute(createInteraction());
    await flushPromises();

    const workspace = createMockWorkspace();
    expect(workspace.discardChanges).not.toHaveBeenCalled();
  });
});

describe("ResetCommand success flow", () => {
  let command: ResetCommand;
  let workspace: WorkspaceManager;
  let discordClient: DiscordClient;

  beforeEach(() => {
    workspace = createMockWorkspace();
    discordClient = createMockDiscordClient();
    command = new ResetCommand({
      redis: createMockRedis(),
      workspace,
      discordClient,
    });
    vi.restoreAllMocks();
  });

  it("discards changes and responds with success message", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(workspace.discardChanges).toHaveBeenCalledWith(
      "/workspace/issue-42",
    );

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
    discordClient = createMockDiscordClient();
    const workspace = createMockWorkspace();
    (workspace.discardChanges as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new AppError("git checkout failed", "GIT_ERROR")),
    );
    command = new ResetCommand({
      redis: createMockRedis(),
      workspace,
      discordClient,
    });
    vi.restoreAllMocks();
  });

  it("responds with error message when discardChanges fails", async () => {
    const state = createMockThreadState();
    (validateThreadCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      state,
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "変更の破棄に失敗しました: git checkout failed",
    );
  });
});
