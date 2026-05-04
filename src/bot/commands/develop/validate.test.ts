import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexExecClient } from "@/ai/client/codex-exec.client";
import type { RedisClient } from "@/infrastructure/redis/redis.client";
import type { ThreadState } from "@/infrastructure/redis/thread-state.types";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import { executeCodexOrResume, validateThreadCommand } from "./validate";

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

function createMockThreadState(
  overrides: Partial<ThreadState> = {},
): ThreadState {
  return {
    initiatedBy: "user-123",
    issueNumber: 42,
    repo: "owner/repo",
    branch: "feature/test",
    workspacePath: "/workspace/repo",
    currentPhase: "planned",
    subStage: "idle",
    lastError: null,
    planOutput: null,
    ...overrides,
  };
}

function createMockDiscordClient(): DiscordClient {
  return {
    isThreadChannel: vi.fn().mockResolvedValue(true),
    editInteractionResponse: vi.fn().mockResolvedValue(undefined),
  } as unknown as DiscordClient;
}

function createMockRedisClient(): RedisClient {
  return {
    getThreadState: vi.fn().mockResolvedValue(createMockThreadState()),
    getCodexThread: vi.fn().mockResolvedValue(null),
    saveCodexThread: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisClient;
}

function createMockCodexExecClient(): CodexExecClient {
  return {
    startThread: vi.fn().mockResolvedValue({
      response: "done",
      threadId: "thread-new",
      usage: null,
    }),
    resumeThread: vi.fn().mockResolvedValue({
      response: "resumed",
      threadId: "thread-existing",
      usage: null,
    }),
  } as unknown as CodexExecClient;
}

describe("validateThreadCommand", () => {
  let discordClient: DiscordClient;
  let redis: RedisClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    discordClient = createMockDiscordClient();
    redis = createMockRedisClient();
  });

  it("returns null when not in thread (edits response)", async () => {
    (
      discordClient.isThreadChannel as ReturnType<typeof vi.fn>
    ).mockResolvedValue(false);

    const result = await validateThreadCommand({
      discordClient,
      redis,
      channelId: "channel-1",
      userId: "user-123",
      expectedPhases: ["planned"],
      interactionToken: "token-abc",
    });

    expect(result).toBeNull();
    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "token-abc",
      "このコマンドはスレッド内で実行してください。",
    );
  });

  it("returns null when no thread state exists", async () => {
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await validateThreadCommand({
      discordClient,
      redis,
      channelId: "channel-1",
      userId: "user-123",
      expectedPhases: ["planned"],
      interactionToken: "token-abc",
    });

    expect(result).toBeNull();
    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "token-abc",
      "ワークフローが初期化されていません。先に `/init` を実行してください。",
    );
  });

  it("returns null when userId doesn't match initiatedBy", async () => {
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(
      createMockThreadState({ initiatedBy: "user-123" }),
    );

    const result = await validateThreadCommand({
      discordClient,
      redis,
      channelId: "channel-1",
      userId: "user-456",
      expectedPhases: ["planned"],
      interactionToken: "token-abc",
    });

    expect(result).toBeNull();
    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "token-abc",
      "このワークフローの実行者のみが操作できます。",
    );
  });

  it("returns null when phase is not in expectedPhases", async () => {
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(
      createMockThreadState({ currentPhase: "init" }),
    );

    const result = await validateThreadCommand({
      discordClient,
      redis,
      channelId: "channel-1",
      userId: "user-123",
      expectedPhases: ["planned", "developed"],
      interactionToken: "token-abc",
    });

    expect(result).toBeNull();
    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "token-abc",
      "現在のフェーズが不正です (現在: init, 期待: planned または developed)",
    );
  });

  it("returns null when subStage is running", async () => {
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(
      createMockThreadState({ subStage: "running" }),
    );

    const result = await validateThreadCommand({
      discordClient,
      redis,
      channelId: "channel-1",
      userId: "user-123",
      expectedPhases: ["planned"],
      interactionToken: "token-abc",
    });

    expect(result).toBeNull();
    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "token-abc",
      "現在別の処理が実行中です。完了してから再試行してください。",
    );
  });

  it("returns state when all validations pass", async () => {
    const state = createMockThreadState();
    (redis.getThreadState as ReturnType<typeof vi.fn>).mockResolvedValue(state);

    const result = await validateThreadCommand({
      discordClient,
      redis,
      channelId: "channel-1",
      userId: "user-123",
      expectedPhases: ["planned"],
      interactionToken: "token-abc",
    });

    expect(result).toEqual({ state });
    expect(discordClient.editInteractionResponse).not.toHaveBeenCalled();
  });
});

describe("executeCodexOrResume", () => {
  let codexExec: CodexExecClient;
  let redis: RedisClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    codexExec = createMockCodexExecClient();
    redis = createMockRedisClient();
  });

  it("calls startThread when no existing thread ID", async () => {
    (redis.getCodexThread as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await executeCodexOrResume({
      codexExec,
      redis,
      channelId: "channel-1",
      phase: "develop",
      prompt: "implement feature",
      cwd: "/workspace/repo",
      sandboxMode: "write",
    });

    expect(codexExec.startThread).toHaveBeenCalledWith("implement feature", {
      prompt: "implement feature",
      cwd: "/workspace/repo",
      sandboxMode: "write",
    });
    expect(codexExec.resumeThread).not.toHaveBeenCalled();
    expect(result.threadId).toBe("thread-new");
    expect(result.response).toBe("done");
  });

  it("calls resumeThread when existing thread ID exists", async () => {
    (redis.getCodexThread as ReturnType<typeof vi.fn>).mockResolvedValue(
      "thread-old",
    );

    const result = await executeCodexOrResume({
      codexExec,
      redis,
      channelId: "channel-1",
      phase: "develop",
      prompt: "continue feature",
      cwd: "/workspace/repo",
      sandboxMode: "write",
    });

    expect(codexExec.resumeThread).toHaveBeenCalledWith(
      "thread-old",
      "continue feature",
      {
        prompt: "continue feature",
        cwd: "/workspace/repo",
        sandboxMode: "write",
      },
    );
    expect(codexExec.startThread).not.toHaveBeenCalled();
    expect(result.threadId).toBe("thread-existing");
    expect(result.response).toBe("resumed");
  });

  it("saves codex thread ID after execution", async () => {
    (redis.getCodexThread as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await executeCodexOrResume({
      codexExec,
      redis,
      channelId: "channel-1",
      phase: "develop",
      prompt: "implement feature",
      cwd: "/workspace/repo",
      sandboxMode: "write",
    });

    expect(redis.saveCodexThread).toHaveBeenCalledWith(
      "channel-1",
      "develop",
      "thread-new",
    );
  });
});
