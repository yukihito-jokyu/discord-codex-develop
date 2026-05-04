import { MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexExecClient } from "@/ai/client/codex-exec.client";
import type { GitHubClient } from "@/infrastructure/github/github.client";
import type { RedisClient } from "@/infrastructure/redis/redis.client";
import type { ThreadState } from "@/infrastructure/redis/thread-state.types";
import type { WorkspaceManager } from "@/infrastructure/workspace/workspace.manager";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { AppError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { PrCommand } from "./pr.command";

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
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

function createMockRedisClient(): RedisClient {
  return {
    getThreadState: vi.fn().mockResolvedValue(createMockThreadState()),
    saveThreadState: vi.fn().mockResolvedValue(undefined),
    getCodexThread: vi.fn().mockResolvedValue(null),
    saveCodexThread: vi.fn().mockResolvedValue(undefined),
    compareAndSwapPhase: vi.fn().mockResolvedValue(true),
  } as unknown as RedisClient;
}

function createMockCodexExecClient(): CodexExecClient {
  return {
    startThread: vi.fn().mockResolvedValue({
      threadId: "codex-thread-1",
      response: "push response",
      usage: null,
    }),
    resumeThread: vi.fn().mockResolvedValue({
      threadId: "codex-thread-1",
      response: "push response",
      usage: null,
    }),
  } as unknown as CodexExecClient;
}

function createMockGitHubClient(): GitHubClient {
  return {
    getIssue: vi.fn().mockResolvedValue(
      ok({
        number: 15,
        title: "Test",
        body: "body",
        owner: "o",
        repo: "r",
        state: "open",
        labels: [],
        assignees: [],
        createdAt: "",
        updatedAt: "",
      }),
    ),
    createPullRequest: vi
      .fn()
      .mockResolvedValue(
        ok({ url: "https://github.com/o/r/pull/1", number: 1 }),
      ),
  } as unknown as GitHubClient;
}

function createMockWorkspaceManager(): WorkspaceManager {
  return {} as unknown as WorkspaceManager;
}

function createMockDiscordClient(): DiscordClient {
  return {
    editInteractionResponse: vi.fn().mockResolvedValue("msg-123"),
    isThreadChannel: vi.fn().mockResolvedValue(true),
  } as unknown as DiscordClient;
}

function createCommandDeps() {
  return {
    redis: createMockRedisClient(),
    codexExec: createMockCodexExecClient(),
    workspace: createMockWorkspaceManager(),
    github: createMockGitHubClient(),
    discordClient: createMockDiscordClient(),
    githubOwner: "o",
    githubRepo: "r",
  };
}

describe("PrCommand properties", () => {
  it("has name 'pr'", () => {
    const command = new PrCommand(createCommandDeps());
    expect(command.name).toBe("pr");
  });
});

describe("PrCommand deferred response", () => {
  let command: PrCommand;
  let deps: ReturnType<typeof createCommandDeps>;

  beforeEach(() => {
    vi.restoreAllMocks();
    deps = createCommandDeps();
    command = new PrCommand(deps);
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
  let deps: ReturnType<typeof createCommandDeps>;

  beforeEach(() => {
    vi.restoreAllMocks();
    deps = createCommandDeps();
    command = new PrCommand(deps);
  });

  it("requires phase 'committed'", async () => {
    await command.execute(createInteraction());
    await flushPromises();

    expect(deps.codexExec.startThread).toHaveBeenCalled();
  });

  it("rejects when phase is wrong", async () => {
    deps.redis.getThreadState = vi
      .fn()
      .mockResolvedValue(createMockThreadState({ currentPhase: "tested" }));

    await command.execute(createInteraction());
    await flushPromises();

    expect(deps.discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "現在のフェーズが不正です (現在: tested, 期待: committed)",
    );
    expect(deps.codexExec.startThread).not.toHaveBeenCalled();
  });
});

describe("PrCommand success flow", () => {
  let command: PrCommand;
  let deps: ReturnType<typeof createCommandDeps>;

  beforeEach(() => {
    vi.restoreAllMocks();
    deps = createCommandDeps();
    command = new PrCommand(deps);
  });

  it("pushes branch via codex, creates PR on GitHub, updates phase to completed, responds with PR URL", async () => {
    await command.execute(createInteraction());
    await flushPromises();

    // Push branch via codex
    expect(deps.codexExec.startThread).toHaveBeenCalledWith(
      expect.stringContaining("git push -u origin HEAD"),
      expect.objectContaining({
        cwd: "/workspace/test-repo",
        sandboxMode: "write",
      }),
    );

    // Fetches issue for title
    expect(deps.github.getIssue).toHaveBeenCalledWith("o", "r", 15);

    // Creates PR on GitHub
    expect(deps.github.createPullRequest).toHaveBeenCalledWith("o", "r", {
      title: "Test",
      body: "Closes #15\n\nbody",
      head: "feature/15",
      base: "main",
    });

    // Updates phase to completed
    expect(deps.redis.compareAndSwapPhase).toHaveBeenCalledWith(
      "thread-1",
      "committed",
      "completed",
    );

    // Saves thread state
    expect(deps.redis.saveThreadState).toHaveBeenCalled();

    // Responds with PR URL
    expect(deps.discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      expect.stringContaining("https://github.com/o/r/pull/1"),
    );
  });
});

describe("PrCommand PR creation failure", () => {
  let command: PrCommand;
  let deps: ReturnType<typeof createCommandDeps>;

  beforeEach(() => {
    vi.restoreAllMocks();
    deps = createCommandDeps();
    command = new PrCommand(deps);
  });

  it("handles error when PR creation fails", async () => {
    deps.github.createPullRequest = vi
      .fn()
      .mockResolvedValue(err(new AppError("PR already exists", "PR_ERROR")));

    await command.execute(createInteraction());
    await flushPromises();

    expect(deps.discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "PRの作成に失敗しました: PR already exists",
    );

    expect(deps.redis.saveThreadState).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        subStage: "idle",
        lastError: "PR already exists",
      }),
    );
  });
});

describe("PrCommand codex push failure", () => {
  let command: PrCommand;
  let deps: ReturnType<typeof createCommandDeps>;

  beforeEach(() => {
    vi.restoreAllMocks();
    deps = createCommandDeps();
    command = new PrCommand(deps);
  });

  it("handles error when codex push fails", async () => {
    deps.codexExec.startThread = vi
      .fn()
      .mockRejectedValue(new Error("push failed"));

    await command.execute(createInteraction());
    await flushPromises();

    expect(deps.discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "PR作成中にエラーが発生しました。しばらくしてから再試行してください。",
    );

    expect(deps.redis.saveThreadState).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        subStage: "idle",
        lastError: "push failed",
      }),
    );
  });
});
