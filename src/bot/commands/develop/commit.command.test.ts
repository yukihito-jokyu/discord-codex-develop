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
import { CommitCommand } from "./commit.command";

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/ai/prompts/templates/develop-commit", () => ({
  buildDevelopCommitPrompt: vi.fn().mockReturnValue("built-commit-prompt"),
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
      response: "commit response",
      usage: null,
    }),
    resumeThread: vi.fn().mockResolvedValue({
      threadId: "codex-thread-1",
      response: "commit response",
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
  return {
    getDiff: vi.fn().mockResolvedValue(ok("diff content")),
  } as unknown as WorkspaceManager;
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

describe("CommitCommand properties", () => {
  it("has name 'commit'", () => {
    const command = new CommitCommand(createCommandDeps());
    expect(command.name).toBe("commit");
  });
});

describe("CommitCommand deferred response", () => {
  let command: CommitCommand;
  let deps: ReturnType<typeof createCommandDeps>;

  beforeEach(() => {
    vi.restoreAllMocks();
    deps = createCommandDeps();
    command = new CommitCommand(deps);
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
  let deps: ReturnType<typeof createCommandDeps>;

  beforeEach(() => {
    vi.restoreAllMocks();
    deps = createCommandDeps();
    command = new CommitCommand(deps);
  });

  it("requires phase 'tested'", async () => {
    await command.execute(createInteraction());
    await flushPromises();

    expect(deps.workspace.getDiff).toHaveBeenCalled();
  });

  it("rejects when phase is wrong", async () => {
    deps.redis.getThreadState = vi
      .fn()
      .mockResolvedValue(createMockThreadState({ currentPhase: "developed" }));

    await command.execute(createInteraction());
    await flushPromises();

    expect(deps.discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "現在のフェーズが不正です (現在: developed, 期待: tested)",
    );
    expect(deps.workspace.getDiff).not.toHaveBeenCalled();
  });
});

describe("CommitCommand success flow", () => {
  let command: CommitCommand;
  let deps: ReturnType<typeof createCommandDeps>;

  beforeEach(() => {
    vi.restoreAllMocks();
    deps = createCommandDeps();
    command = new CommitCommand(deps);
  });

  it("gets diff, fetches issue for title, builds commit prompt, executes codex, updates phase to committed", async () => {
    await command.execute(createInteraction());
    await flushPromises();

    // Gets diff from workspace
    expect(deps.workspace.getDiff).toHaveBeenCalledWith("/workspace/test-repo");

    // Fetches issue for title
    expect(deps.github.getIssue).toHaveBeenCalledWith("o", "r", 15);

    // Builds commit prompt (mocked, but we verify codexExec was called)
    expect(deps.codexExec.startThread).toHaveBeenCalledWith(
      "built-commit-prompt",
      expect.objectContaining({
        cwd: "/workspace/test-repo",
        sandboxMode: "write",
      }),
    );

    // Updates phase to committed
    expect(deps.redis.compareAndSwapPhase).toHaveBeenCalledWith(
      "thread-1",
      "tested",
      "committed",
    );

    // Saves thread state
    expect(deps.redis.saveThreadState).toHaveBeenCalled();

    // Responds with formatted output
    expect(deps.discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      expect.any(String),
    );
  });
});

describe("CommitCommand diff fetch failure", () => {
  let command: CommitCommand;
  let deps: ReturnType<typeof createCommandDeps>;

  beforeEach(() => {
    vi.restoreAllMocks();
    deps = createCommandDeps();
    command = new CommitCommand(deps);
  });

  it("returns error when workspace.getDiff returns err", async () => {
    deps.workspace.getDiff = vi
      .fn()
      .mockResolvedValue(err(new AppError("diff failed", "DIFF_ERROR")));

    await command.execute(createInteraction());
    await flushPromises();

    expect(deps.discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "diffの取得に失敗しました: diff failed",
    );

    // Should not proceed to codex execution
    expect(deps.codexExec.startThread).not.toHaveBeenCalled();

    // subStage should be reset to idle
    expect(deps.redis.saveThreadState).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({ subStage: "idle" }),
    );
  });
});

describe("CommitCommand codex failure", () => {
  let command: CommitCommand;
  let deps: ReturnType<typeof createCommandDeps>;

  beforeEach(() => {
    vi.restoreAllMocks();
    deps = createCommandDeps();
    command = new CommitCommand(deps);
  });

  it("handles error when codex throws", async () => {
    deps.codexExec.startThread = vi
      .fn()
      .mockRejectedValue(new Error("codex crashed"));

    await command.execute(createInteraction());
    await flushPromises();

    expect(deps.discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "コミット中にエラーが発生しました。しばらくしてから再試行してください。",
    );

    expect(deps.redis.saveThreadState).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        subStage: "idle",
        lastError: "codex crashed",
      }),
    );
  });
});
