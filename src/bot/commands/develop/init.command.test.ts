import { MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "@/infrastructure/github/github.client";
import type { RedisClient } from "@/infrastructure/redis/redis.client";
import type { WorkspaceManager } from "@/infrastructure/workspace/workspace.manager";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { AppError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { InitCommand } from "./init.command";

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

function createInteraction(
  overrides: Partial<DomainInteraction> = {},
): DomainInteraction {
  return {
    id: "test-id",
    type: "command",
    channelId: "channel-1",
    userId: "user-1",
    commandName: "init",
    options: { "issue-number": 15 },
    raw: { token: "test-token" },
    ...overrides,
  };
}

function createMockRedisClient(): RedisClient {
  return {
    getThreadState: vi.fn().mockResolvedValue(null),
    saveThreadState: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisClient;
}

function createMockGitHubClient(): GitHubClient {
  return {
    getIssue: vi.fn().mockResolvedValue(
      ok({
        number: 15,
        title: "Test Issue",
        body: "body",
        owner: "owner",
        repo: "repo",
        state: "open" as const,
        labels: [],
        assignees: [],
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      }),
    ),
  } as unknown as GitHubClient;
}

function createMockWorkspaceManager(): WorkspaceManager {
  return {
    ensureClone: vi.fn().mockResolvedValue(ok(undefined)),
    syncMain: vi.fn().mockResolvedValue(ok(undefined)),
    createBranch: vi.fn().mockResolvedValue(ok(undefined)),
  } as unknown as WorkspaceManager;
}

function createMockDiscordClient(): DiscordClient {
  return {
    isThreadChannel: vi.fn().mockResolvedValue(false),
    editInteractionResponse: vi.fn().mockResolvedValue("msg-id"),
    createThreadFromMessage: vi.fn().mockResolvedValue("thread-id"),
  } as unknown as DiscordClient;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createCommand(overrides: Record<string, unknown> = {}) {
  const redis = createMockRedisClient();
  const github = createMockGitHubClient();
  const workspace = createMockWorkspaceManager();
  const discordClient = createMockDiscordClient();
  const command = new InitCommand({
    redis,
    github,
    workspace,
    discordClient,
    githubOwner: "test-owner",
    githubRepo: "test-repo",
    ...overrides,
  });
  return { command, redis, github, workspace, discordClient };
}

describe("InitCommand properties", () => {
  it('has name "init"', () => {
    const { command } = createCommand();
    expect(command.name).toBe("init");
  });

  it("has definition with correct description and options", () => {
    const { command } = createCommand();
    expect(command.definition).toEqual({
      description: "Issueから開発ワークフローを初期化",
      options: [
        {
          name: "issue-number",
          description: "Issue番号",
          type: 4,
          required: true,
        },
      ],
    });
  });
});

describe("InitCommand execute", () => {
  let command: InitCommand;

  beforeEach(() => {
    ({ command } = createCommand());
    vi.restoreAllMocks();
  });

  it("returns deferred response on valid token", async () => {
    const response = await command.execute(createInteraction());

    expect(response.type).toBe(5);
  });

  it("returns error when no token", async () => {
    const response = await command.execute(createInteraction({ raw: {} }));

    expect(response.type).toBe(4);
    expect(response.data?.flags).toBe(MessageFlags.Ephemeral);
  });
});

describe("InitCommand validation", () => {
  let redis: RedisClient;
  let discordClient: DiscordClient;
  let command: InitCommand;

  beforeEach(() => {
    ({ command, redis, discordClient } = createCommand());
    vi.restoreAllMocks();
  });

  it("rejects non-positive issue number", async () => {
    await command.execute(
      createInteraction({ options: { "issue-number": -1 } }),
    );
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "Issue番号は正の整数で指定してください。",
    );
  });

  it("rejects zero issue number", async () => {
    await command.execute(
      createInteraction({ options: { "issue-number": 0 } }),
    );
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "Issue番号は正の整数で指定してください。",
    );
  });

  it("rejects non-integer issue number", async () => {
    await command.execute(
      createInteraction({ options: { "issue-number": 3.5 } }),
    );
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "Issue番号は正の整数で指定してください。",
    );
  });

  it("rejects when called inside a thread", async () => {
    (
      discordClient.isThreadChannel as ReturnType<typeof vi.fn>
    ).mockResolvedValue(true);

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "このコマンドはスレッド外のチャンネルで実行してください。",
    );
  });

  it("rejects when existing workflow is running (subStage === 'running')", async () => {
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue({
      initiatedBy: "user-1",
      issueNumber: 10,
      subStage: "running",
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "現在別の処理が実行中です。完了してから再試行してください。",
    );
  });

  it("rejects when different user tries to re-init", async () => {
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue({
      initiatedBy: "other-user",
      issueNumber: 10,
      subStage: "idle",
    });

    await command.execute(createInteraction({ userId: "user-1" }));
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "このワークフローは別のユーザーが初期化しました。",
    );
  });
});

describe("InitCommand error handling", () => {
  let github: GitHubClient;
  let workspace: WorkspaceManager;
  let discordClient: DiscordClient;
  let command: InitCommand;

  beforeEach(() => {
    const vars = createCommand();
    github = vars.github;
    workspace = vars.workspace;
    discordClient = vars.discordClient;
    command = vars.command;
    vi.restoreAllMocks();
  });

  it("handles github.getIssue failure", async () => {
    (github.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new AppError("not found", "NOT_FOUND")),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "Issue #15 の取得に失敗しました: not found",
    );
  });

  it("handles workspace.ensureClone failure", async () => {
    (workspace.ensureClone as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new AppError("clone failed", "EXTERNAL_SERVICE_ERROR")),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "リポジトリのcloneに失敗しました: clone failed",
    );
  });

  it("handles workspace.syncMain failure", async () => {
    (workspace.syncMain as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new AppError("sync failed", "EXTERNAL_SERVICE_ERROR")),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "mainブランチの同期に失敗しました: sync failed",
    );
  });

  it("handles workspace.createBranch failure", async () => {
    (workspace.createBranch as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new AppError("branch failed", "EXTERNAL_SERVICE_ERROR")),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "ブランチの作成に失敗しました: branch failed",
    );
  });
});

describe("InitCommand success flow", () => {
  let redis: RedisClient;
  let github: GitHubClient;
  let workspace: WorkspaceManager;
  let discordClient: DiscordClient;
  let command: InitCommand;

  beforeEach(() => {
    const vars = createCommand();
    redis = vars.redis;
    github = vars.github;
    workspace = vars.workspace;
    discordClient = vars.discordClient;
    command = vars.command;
    vi.restoreAllMocks();
  });

  it("fetches issue, clones repo, syncs main, creates branch, creates thread, saves state", async () => {
    await command.execute(createInteraction());
    await flushPromises();

    expect(github.getIssue).toHaveBeenCalledWith("test-owner", "test-repo", 15);

    expect(workspace.ensureClone).toHaveBeenCalledWith(
      "https://github.com/test-owner/test-repo.git",
      "test-repo-15",
    );

    expect(workspace.syncMain).toHaveBeenCalledWith("test-repo-15");

    expect(workspace.createBranch).toHaveBeenCalledWith(
      "test-repo-15",
      "feature/15",
    );

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "**Issue #15: Test Issue**\n\nbody",
    );

    expect(discordClient.createThreadFromMessage).toHaveBeenCalledWith(
      "channel-1",
      "msg-id",
      "Issue #15: Test Issue",
    );

    expect(redis.saveThreadState).toHaveBeenCalledWith("thread-id", {
      initiatedBy: "user-1",
      issueNumber: 15,
      repo: "test-owner/test-repo",
      branch: "feature/15",
      workspacePath: "test-repo-15",
      currentPhase: "init",
      subStage: "idle",
      lastError: null,
      planOutput: null,
    });
  });
});
