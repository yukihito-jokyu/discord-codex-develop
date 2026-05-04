import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexExecClient } from "@/ai/client/codex-exec.client";
import type { GitHubClient } from "@/infrastructure/github/github.client";
import type { RedisClient } from "@/infrastructure/redis/redis.client";
import type { ThreadState } from "@/infrastructure/redis/thread-state.types";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { ExternalServiceError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { PlanCommand } from "./plan.command";

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/ai/prompts/templates/develop-plan", () => ({
  buildDevelopPlanPrompt: vi.fn().mockReturnValue("plan-prompt"),
}));

vi.mock("./validate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./validate")>();
  return {
    validateThreadCommand: actual.validateThreadCommand,
    executeCodexOrResume: vi.fn().mockResolvedValue({
      threadId: "thread-1",
      response: "plan response",
      usage: null,
    }),
  };
});

vi.mock("@/shared/utils/format", () => ({
  formatForDiscord: vi.fn((text: string) => `formatted:${text}`),
}));

// --- Mock factories ---

function createMockRedisClient(): RedisClient {
  return {
    getThreadState: vi.fn().mockResolvedValue(null),
    saveThreadState: vi.fn().mockResolvedValue(undefined),
    compareAndSwapPhase: vi.fn().mockResolvedValue(true),
    getCodexThread: vi.fn().mockResolvedValue(null),
    saveCodexThread: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisClient;
}

function createMockCodexExecClient(): CodexExecClient {
  return {
    startThread: vi.fn().mockResolvedValue({
      threadId: "thread-1",
      response: "plan response",
      usage: null,
    }),
    resumeThread: vi.fn().mockResolvedValue({
      threadId: "thread-1",
      response: "plan response",
      usage: null,
    }),
  } as unknown as CodexExecClient;
}

function createMockGitHubClient(): GitHubClient {
  return {
    getIssue: vi.fn().mockResolvedValue(
      ok({
        number: 42,
        title: "Test Issue",
        body: "Issue body content",
        owner: "owner",
        repo: "repo",
        state: "open",
        labels: [],
        assignees: [],
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      }),
    ),
  } as unknown as GitHubClient;
}

function createMockDiscordClient(): DiscordClient {
  return {
    editInteractionResponse: vi.fn().mockResolvedValue("msg-123"),
    isThreadChannel: vi.fn().mockResolvedValue(true),
  } as unknown as DiscordClient;
}

// --- Helpers ---

function createInteraction(
  overrides: Partial<DomainInteraction> = {},
): DomainInteraction {
  return {
    id: "test-id",
    type: "command",
    channelId: "channel-1",
    userId: "user-1",
    commandName: "plan",
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
    workspacePath: "/workspace/feature-42",
    currentPhase: "init",
    subStage: "idle",
    lastError: null,
    planOutput: null,
    ...overrides,
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// --- Tests ---

describe("PlanCommand properties", () => {
  it("has name 'plan'", () => {
    const command = new PlanCommand({
      redis: createMockRedisClient(),
      codexExec: createMockCodexExecClient(),
      github: createMockGitHubClient(),
      discordClient: createMockDiscordClient(),
      githubOwner: "owner",
      githubRepo: "repo",
    });
    expect(command.name).toBe("plan");
  });

  it("has definition with description", () => {
    const command = new PlanCommand({
      redis: createMockRedisClient(),
      codexExec: createMockCodexExecClient(),
      github: createMockGitHubClient(),
      discordClient: createMockDiscordClient(),
      githubOwner: "owner",
      githubRepo: "repo",
    });
    expect(command.definition).toEqual({
      description: "Issueに基づいて実装計画を作成",
    });
  });
});

describe("PlanCommand execute - token handling", () => {
  let redis: RedisClient;
  let codexExec: CodexExecClient;
  let github: GitHubClient;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    redis = createMockRedisClient();
    codexExec = createMockCodexExecClient();
    github = createMockGitHubClient();
    discordClient = createMockDiscordClient();
  });

  it("returns deferred response on valid token", async () => {
    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    const response = await command.execute(createInteraction());

    // DeferredChannelMessageWithSource = 5
    expect(response.type).toBe(5);
  });

  it("returns error when no token", async () => {
    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    const response = await command.execute(createInteraction({ raw: {} }));

    // ChannelMessageWithSource = 4
    expect(response.type).toBe(4);
    expect(response.data?.flags).toBe(64); // MessageFlags.Ephemeral
  });
});

describe("PlanCommand execute - thread state validation", () => {
  let redis: RedisClient;
  let codexExec: CodexExecClient;
  let github: GitHubClient;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    redis = createMockRedisClient();
    codexExec = createMockCodexExecClient();
    github = createMockGitHubClient();
    discordClient = createMockDiscordClient();
  });

  it("rejects if not in a thread channel", async () => {
    (
      discordClient.isThreadChannel as ReturnType<typeof vi.fn>
    ).mockResolvedValue(false);

    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "このコマンドはスレッド内で実行してください。",
    );
  });

  it("rejects if no thread state found", async () => {
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "ワークフローが初期化されていません。先に `/init` を実行してください。",
    );
  });

  it("rejects if wrong user (initiatedBy mismatch)", async () => {
    const state = createMockThreadState({ initiatedBy: "other-user" });
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(state);

    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    await command.execute(createInteraction({ userId: "user-1" }));
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "このワークフローの実行者のみが操作できます。",
    );
  });

  it("rejects if wrong phase", async () => {
    const state = createMockThreadState({ currentPhase: "developed" });
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(state);

    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "現在のフェーズが不正です (現在: developed, 期待: init または planned)",
    );
  });

  it("rejects if subStage is running", async () => {
    const state = createMockThreadState({ subStage: "running" });
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(state);

    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "現在別の処理が実行中です。完了してから再試行してください。",
    );
  });
});

describe("PlanCommand execute - github.getIssue failure", () => {
  let redis: RedisClient;
  let codexExec: CodexExecClient;
  let github: GitHubClient;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    redis = createMockRedisClient();
    codexExec = createMockCodexExecClient();
    github = createMockGitHubClient();
    discordClient = createMockDiscordClient();
  });

  it("handles github.getIssue failure and responds with error", async () => {
    const state = createMockThreadState();
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(state);
    (github.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new ExternalServiceError("GitHub", "API rate limit")),
    );

    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "Issue #42 の取得に失敗しました: GitHub: API rate limit",
    );
  });
});

describe("PlanCommand execute - success flow", () => {
  let redis: RedisClient;
  let codexExec: CodexExecClient;
  let github: GitHubClient;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    redis = createMockRedisClient();
    codexExec = createMockCodexExecClient();
    github = createMockGitHubClient();
    discordClient = createMockDiscordClient();
  });

  it("validates, fetches issue, builds prompt, executes codex, updates state, responds", async () => {
    const state = createMockThreadState();
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(state);

    // Ensure executeCodexOrResume mock resolves after restoreAllMocks
    const { executeCodexOrResume } = await import("./validate");
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      threadId: "thread-1",
      response: "plan response",
      usage: null,
    });

    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    await command.execute(createInteraction());
    await flushPromises();

    // Verify github.getIssue was called with correct args
    expect(github.getIssue).toHaveBeenCalledWith("owner", "repo", 42);

    // Verify buildDevelopPlanPrompt was called
    const { buildDevelopPlanPrompt } = await import(
      "@/ai/prompts/templates/develop-plan"
    );
    expect(buildDevelopPlanPrompt).toHaveBeenCalledWith({
      issueBody: "Issue body content",
      repo: "owner/repo",
      branch: "feature/42",
    });

    // Verify executeCodexOrResume was called
    expect(executeCodexOrResume).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "plan",
        prompt: "plan-prompt",
        cwd: "/workspace/feature-42",
        sandboxMode: "read-only",
      }),
    );

    // Verify compareAndSwapPhase was called with correct phases
    expect(redis.compareAndSwapPhase).toHaveBeenCalledWith(
      "channel-1",
      "init",
      "planned",
    );

    // Verify planOutput is saved in state
    const savedState = (
      redis.saveThreadState as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[1] as ThreadState | undefined;
    expect(savedState?.planOutput).toBe("plan response");
    expect(savedState?.subStage).toBe("idle");
    // When CAS succeeds, state.currentPhase is not updated in memory;
    // Redis CAS script handles the phase transition internally.
    expect(savedState?.currentPhase).toBe("init");

    // Verify discordClient.editInteractionResponse was called with formatted response
    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "formatted:plan response",
    );
  });
});

describe("PlanCommand execute - error handling", () => {
  let redis: RedisClient;
  let codexExec: CodexExecClient;
  let github: GitHubClient;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    redis = createMockRedisClient();
    codexExec = createMockCodexExecClient();
    github = createMockGitHubClient();
    discordClient = createMockDiscordClient();
  });

  it("catches codex execution errors and responds with error message", async () => {
    const state = createMockThreadState();
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(state);

    const { executeCodexOrResume } = await import("./validate");
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Codex timeout"),
    );

    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    await command.execute(createInteraction());
    await flushPromises();

    // Verify state was reset with error info
    const savedState = (
      redis.saveThreadState as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[1] as ThreadState | undefined;
    expect(savedState?.subStage).toBe("idle");
    expect(savedState?.lastError).toBe("Codex timeout");

    // Verify error response was sent
    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "計画の作成中にエラーが発生しました。しばらくしてから再試行してください。",
    );
  });
});

describe("PlanCommand execute - compareAndSwapPhase verification", () => {
  let redis: RedisClient;
  let codexExec: CodexExecClient;
  let github: GitHubClient;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    redis = createMockRedisClient();
    codexExec = createMockCodexExecClient();
    github = createMockGitHubClient();
    discordClient = createMockDiscordClient();
  });

  it("calls compareAndSwapPhase with current phase and 'planned'", async () => {
    const state = createMockThreadState({ currentPhase: "init" });
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(state);

    // Ensure executeCodexOrResume mock resolves after restoreAllMocks
    const { executeCodexOrResume } = await import("./validate");
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      threadId: "thread-1",
      response: "plan response",
      usage: null,
    });

    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(redis.compareAndSwapPhase).toHaveBeenCalledWith(
      "channel-1",
      "init",
      "planned",
    );
  });

  it("calls compareAndSwapPhase with 'planned' phase when current is 'planned'", async () => {
    const state = createMockThreadState({ currentPhase: "planned" });
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(state);

    // Ensure executeCodexOrResume mock resolves after restoreAllMocks
    const { executeCodexOrResume } = await import("./validate");
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      threadId: "thread-1",
      response: "plan response",
      usage: null,
    });

    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    await command.execute(createInteraction());
    await flushPromises();

    expect(redis.compareAndSwapPhase).toHaveBeenCalledWith(
      "channel-1",
      "planned",
      "planned",
    );
  });

  it("sets currentPhase to planned even when CAS fails", async () => {
    const state = createMockThreadState({ currentPhase: "init" });
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(state);
    (redis.compareAndSwapPhase as ReturnType<typeof vi.fn>).mockResolvedValue(
      false,
    );

    // Ensure executeCodexOrResume mock resolves after restoreAllMocks
    const { executeCodexOrResume } = await import("./validate");
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      threadId: "thread-1",
      response: "plan response",
      usage: null,
    });

    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    await command.execute(createInteraction());
    await flushPromises();

    const savedState = (
      redis.saveThreadState as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[1] as ThreadState | undefined;
    expect(savedState?.currentPhase).toBe("planned");
  });
});

describe("PlanCommand execute - planOutput saved in state", () => {
  let redis: RedisClient;
  let codexExec: CodexExecClient;
  let github: GitHubClient;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    redis = createMockRedisClient();
    codexExec = createMockCodexExecClient();
    github = createMockGitHubClient();
    discordClient = createMockDiscordClient();
  });

  it("saves codex response as planOutput in state", async () => {
    const state = createMockThreadState();
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(state);

    const { executeCodexOrResume } = await import("./validate");
    (executeCodexOrResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      threadId: "thread-1",
      response: "detailed plan output",
      usage: null,
    });

    const command = new PlanCommand({
      redis,
      codexExec,
      github,
      discordClient,
      githubOwner: "owner",
      githubRepo: "repo",
    });

    await command.execute(createInteraction());
    await flushPromises();

    const savedState = (
      redis.saveThreadState as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[1] as ThreadState | undefined;
    expect(savedState?.planOutput).toBe("detailed plan output");
  });
});
