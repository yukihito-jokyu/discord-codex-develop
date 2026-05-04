import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadState } from "@/infrastructure/redis/thread-state.types";

const mockGetThreadState = vi.fn();
const mockSaveThreadState = vi.fn();
const mockCompareAndSwapPhase = vi.fn();
const mockGetCodexThread = vi.fn();
const mockSaveCodexThread = vi.fn();

const mockStartThread = vi.fn();
const mockResumeThread = vi.fn();

const mockGetIssue = vi.fn();
const mockCreatePullRequest = vi.fn();

const mockEnsureClone = vi.fn();
const mockSyncMain = vi.fn();
const mockCreateBranch = vi.fn();
const mockGetDiff = vi.fn();
const mockDiscardChanges = vi.fn();

const mockBuildPlanPrompt = vi.fn();
const mockBuildImplPrompt = vi.fn();
const mockBuildTestPrompt = vi.fn();
const mockBuildCommitPrompt = vi.fn();

vi.mock("@/infrastructure/redis/redis.client", () => ({
  RedisClient: vi.fn().mockImplementation(() => ({
    getThreadState: mockGetThreadState,
    saveThreadState: mockSaveThreadState,
    compareAndSwapPhase: mockCompareAndSwapPhase,
    getCodexThread: mockGetCodexThread,
    saveCodexThread: mockSaveCodexThread,
  })),
}));

vi.mock("@/ai/client/codex-exec.client", () => ({
  CodexExecClient: vi.fn().mockImplementation(() => ({
    startThread: mockStartThread,
    resumeThread: mockResumeThread,
  })),
}));

vi.mock("@/infrastructure/github/github.client", () => ({
  GitHubClient: vi.fn().mockImplementation(() => ({
    getIssue: mockGetIssue,
    createPullRequest: mockCreatePullRequest,
  })),
}));

vi.mock("@/infrastructure/workspace/workspace.manager", () => ({
  WorkspaceManager: vi.fn().mockImplementation(() => ({
    ensureClone: mockEnsureClone,
    syncMain: mockSyncMain,
    createBranch: mockCreateBranch,
    getDiff: mockGetDiff,
    discardChanges: mockDiscardChanges,
  })),
}));

vi.mock("@/ai/prompts/templates/develop-plan", () => ({
  buildDevelopPlanPrompt: mockBuildPlanPrompt,
}));

vi.mock("@/ai/prompts/templates/develop-impl", () => ({
  buildDevelopImplPrompt: mockBuildImplPrompt,
}));

vi.mock("@/ai/prompts/templates/develop-test", () => ({
  buildDevelopTestPrompt: mockBuildTestPrompt,
}));

vi.mock("@/ai/prompts/templates/develop-commit", () => ({
  buildDevelopCommitPrompt: mockBuildCommitPrompt,
}));

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeState(overrides: Partial<ThreadState> = {}): ThreadState {
  return {
    initiatedBy: "user-1",
    issueNumber: 42,
    repo: "owner/repo",
    branch: "feature/42",
    workspacePath: "/tmp/ws-42",
    currentPhase: "init",
    subStage: "idle",
    lastError: null,
    planOutput: null,
    ...overrides,
  };
}

async function createService() {
  const { DevelopService } = await import("./develop.service");
  const { RedisClient } = await import("@/infrastructure/redis/redis.client");
  const { CodexExecClient } = await import("@/ai/client/codex-exec.client");
  const { GitHubClient } = await import(
    "@/infrastructure/github/github.client"
  );
  const { WorkspaceManager } = await import(
    "@/infrastructure/workspace/workspace.manager"
  );

  return new DevelopService({
    redis: new (RedisClient as unknown as ReturnType<typeof vi.fn>)(),
    codexExec: new (CodexExecClient as unknown as ReturnType<typeof vi.fn>)(),
    github: new (GitHubClient as unknown as ReturnType<typeof vi.fn>)(),
    workspace: new (WorkspaceManager as unknown as ReturnType<typeof vi.fn>)(),
    githubOwner: "owner",
    githubRepo: "repo",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveThreadState.mockResolvedValue(undefined);
  mockCompareAndSwapPhase.mockResolvedValue(true);
  mockGetCodexThread.mockResolvedValue(null);
  mockSaveCodexThread.mockResolvedValue(undefined);
});

describe("DevelopService getState", () => {
  it("returns state from Redis", async () => {
    const state = makeState();
    mockGetThreadState.mockResolvedValue(state);
    const service = await createService();
    const result = await service.getState("ch-1");
    expect(result).toEqual(state);
  });

  it("returns null when not found", async () => {
    mockGetThreadState.mockResolvedValue(null);
    const service = await createService();
    const result = await service.getState("ch-1");
    expect(result).toBeNull();
  });
});

describe("DevelopService saveState", () => {
  it("saves state to Redis", async () => {
    const state = makeState();
    const service = await createService();
    await service.saveState("ch-1", state);
    expect(mockSaveThreadState).toHaveBeenCalledWith("ch-1", state);
  });
});

describe("DevelopService setRunning", () => {
  it("sets subStage to running and saves", async () => {
    const state = makeState();
    const service = await createService();
    await service.setRunning("ch-1", state);
    expect(state.subStage).toBe("running");
    expect(mockSaveThreadState).toHaveBeenCalledWith("ch-1", state);
  });
});

describe("DevelopService setError", () => {
  it("sets subStage to idle and lastError then saves", async () => {
    const state = makeState({ subStage: "running" });
    const service = await createService();
    await service.setError("ch-1", state, "something failed");
    expect(state.subStage).toBe("idle");
    expect(state.lastError).toBe("something failed");
    expect(mockSaveThreadState).toHaveBeenCalledWith("ch-1", state);
  });
});

describe("DevelopService transitionPhase", () => {
  it("calls CAS on Redis", async () => {
    const service = await createService();
    const result = await service.transitionPhase("ch-1", "init", "planned");
    expect(result).toBe(true);
    expect(mockCompareAndSwapPhase).toHaveBeenCalledWith(
      "ch-1",
      "init",
      "planned",
    );
  });

  it("returns false when CAS fails", async () => {
    mockCompareAndSwapPhase.mockResolvedValue(false);
    const service = await createService();
    const result = await service.transitionPhase("ch-1", "init", "planned");
    expect(result).toBe(false);
  });
});

describe("DevelopService validateThreadCommand", () => {
  it("returns error when state not found", async () => {
    mockGetThreadState.mockResolvedValue(null);
    const service = await createService();
    const result = await service.validateThreadCommand({
      channelId: "ch-1",
      userId: "user-1",
      expectedPhases: ["init"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("初期化");
    }
  });

  it("returns error when user does not match", async () => {
    mockGetThreadState.mockResolvedValue(makeState({ initiatedBy: "other" }));
    const service = await createService();
    const result = await service.validateThreadCommand({
      channelId: "ch-1",
      userId: "user-1",
      expectedPhases: ["init"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("実行者");
    }
  });

  it("returns error when phase is unexpected", async () => {
    mockGetThreadState.mockResolvedValue(
      makeState({ currentPhase: "developed" }),
    );
    const service = await createService();
    const result = await service.validateThreadCommand({
      channelId: "ch-1",
      userId: "user-1",
      expectedPhases: ["init"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("フェーズ");
    }
  });

  it("returns error when subStage is running", async () => {
    mockGetThreadState.mockResolvedValue(makeState({ subStage: "running" }));
    const service = await createService();
    const result = await service.validateThreadCommand({
      channelId: "ch-1",
      userId: "user-1",
      expectedPhases: ["init"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("実行中");
    }
  });

  it("returns state on success", async () => {
    const state = makeState();
    mockGetThreadState.mockResolvedValue(state);
    const service = await createService();
    const result = await service.validateThreadCommand({
      channelId: "ch-1",
      userId: "user-1",
      expectedPhases: ["init"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toEqual(state);
    }
  });
});

describe("DevelopService validateInit", () => {
  it("returns error for non-positive issue number", async () => {
    const service = await createService();
    const result = await service.validateInit({
      channelId: "ch-1",
      userId: "user-1",
      issueNumber: -1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("正の整数");
    }
  });

  it("returns error for non-integer issue number", async () => {
    const service = await createService();
    const result = await service.validateInit({
      channelId: "ch-1",
      userId: "user-1",
      issueNumber: 1.5,
    });
    expect(result.ok).toBe(false);
  });

  it("returns error when running state exists", async () => {
    mockGetThreadState.mockResolvedValue(makeState({ subStage: "running" }));
    const service = await createService();
    const result = await service.validateInit({
      channelId: "ch-1",
      userId: "user-1",
      issueNumber: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("実行中");
    }
  });

  it("returns error when different user owns state", async () => {
    mockGetThreadState.mockResolvedValue(makeState({ initiatedBy: "other" }));
    const service = await createService();
    const result = await service.validateInit({
      channelId: "ch-1",
      userId: "user-1",
      issueNumber: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("別のユーザー");
    }
  });

  it("returns ok for valid init", async () => {
    mockGetThreadState.mockResolvedValue(null);
    const service = await createService();
    const result = await service.validateInit({
      channelId: "ch-1",
      userId: "user-1",
      issueNumber: 5,
    });
    expect(result.ok).toBe(true);
  });
});

describe("DevelopService fetchIssue", () => {
  it("delegates to GitHubClient", async () => {
    const issue = {
      ok: true as const,
      value: { number: 42, title: "Bug", body: "desc" },
    };
    mockGetIssue.mockResolvedValue(issue);
    const service = await createService();
    const result = await service.fetchIssue(42);
    expect(mockGetIssue).toHaveBeenCalledWith("owner", "repo", 42);
    expect(result).toEqual(issue);
  });
});

describe("DevelopService setupWorkspace", () => {
  it("returns error on clone failure", async () => {
    mockEnsureClone.mockResolvedValue({
      ok: false,
      error: new Error("clone failed"),
    });
    const service = await createService();
    const result = await service.setupWorkspace(42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("clone failed");
    }
  });

  it("returns error on sync failure", async () => {
    mockEnsureClone.mockResolvedValue({ ok: true, value: undefined });
    mockSyncMain.mockResolvedValue({
      ok: false,
      error: new Error("sync failed"),
    });
    const service = await createService();
    const result = await service.setupWorkspace(42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("sync failed");
    }
  });

  it("returns error on branch creation failure", async () => {
    mockEnsureClone.mockResolvedValue({ ok: true, value: undefined });
    mockSyncMain.mockResolvedValue({ ok: true, value: undefined });
    mockCreateBranch.mockResolvedValue({
      ok: false,
      error: new Error("branch failed"),
    });
    const service = await createService();
    const result = await service.setupWorkspace(42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("branch failed");
    }
  });

  it("returns branchName and targetDir on success", async () => {
    mockEnsureClone.mockResolvedValue({ ok: true, value: undefined });
    mockSyncMain.mockResolvedValue({ ok: true, value: undefined });
    mockCreateBranch.mockResolvedValue({ ok: true, value: undefined });
    const service = await createService();
    const result = await service.setupWorkspace(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.branchName).toBe("feature/42");
      expect(result.value.targetDir).toBe("repo-42");
    }
  });
});

describe("DevelopService initializeState", () => {
  it("saves initial ThreadState to Redis", async () => {
    const service = await createService();
    await service.initializeState({
      channelId: "ch-1",
      userId: "user-1",
      issueNumber: 42,
      branchName: "feature/42",
      targetDir: "repo-42",
    });
    expect(mockSaveThreadState).toHaveBeenCalledWith(
      "ch-1",
      expect.objectContaining({
        initiatedBy: "user-1",
        issueNumber: 42,
        repo: "owner/repo",
        branch: "feature/42",
        workspacePath: "repo-42",
        currentPhase: "init",
        subStage: "idle",
        lastError: null,
        planOutput: null,
      }),
    );
  });
});

describe("DevelopService executePlan", () => {
  it("returns error when issue fetch fails", async () => {
    mockGetIssue.mockResolvedValue({
      ok: false,
      error: new Error("not found"),
    });
    const state = makeState({ currentPhase: "init" });
    const service = await createService();
    const result = await service.executePlan("ch-1", state);
    expect(result.ok).toBe(false);
  });

  it("executes codex and updates state", async () => {
    mockGetIssue.mockResolvedValue({
      ok: true,
      value: { number: 42, title: "Bug", body: "desc" },
    });
    mockBuildPlanPrompt.mockReturnValue("plan prompt");
    mockStartThread.mockResolvedValue({
      response: "plan output",
      threadId: "thread-1",
      usage: null,
    });
    const state = makeState({ currentPhase: "init" });
    const service = await createService();
    const result = await service.executePlan("ch-1", state);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.response).toBe("plan output");
    }
    expect(mockBuildPlanPrompt).toHaveBeenCalledWith({
      issueBody: "desc",
      repo: "owner/repo",
      branch: "feature/42",
    });
    expect(state.planOutput).toBe("plan output");
    expect(state.currentPhase).toBe("planned");
    expect(mockCompareAndSwapPhase).toHaveBeenCalledWith(
      "ch-1",
      "init",
      "planned",
    );
  });

  it("resumes existing codex thread", async () => {
    mockGetIssue.mockResolvedValue({
      ok: true,
      value: { number: 42, title: "Bug", body: "desc" },
    });
    mockBuildPlanPrompt.mockReturnValue("plan prompt");
    mockGetCodexThread.mockResolvedValue("existing-thread");
    mockResumeThread.mockResolvedValue({
      response: "resumed output",
      threadId: "existing-thread",
      usage: null,
    });
    const state = makeState({ currentPhase: "init" });
    const service = await createService();
    const result = await service.executePlan("ch-1", state);

    expect(result.ok).toBe(true);
    expect(mockResumeThread).toHaveBeenCalled();
    expect(mockStartThread).not.toHaveBeenCalled();
  });
});

describe("DevelopService executeDevelop", () => {
  it("executes codex in write mode and gets diff", async () => {
    mockBuildImplPrompt.mockReturnValue("impl prompt");
    mockStartThread.mockResolvedValue({
      response: "impl output",
      threadId: "thread-2",
      usage: null,
    });
    mockGetDiff.mockResolvedValue({ ok: true, value: "diff content" });
    const state = makeState({ currentPhase: "planned", planOutput: "plan" });
    const service = await createService();
    const result = await service.executeDevelop("ch-1", state);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.response).toBe("impl output");
      expect(result.value.diff).toBe("diff content");
    }
    expect(state.currentPhase).toBe("developed");
    expect(mockCompareAndSwapPhase).toHaveBeenCalledWith(
      "ch-1",
      "planned",
      "developed",
    );
  });

  it("returns empty diff on getDiff failure", async () => {
    mockBuildImplPrompt.mockReturnValue("impl prompt");
    mockStartThread.mockResolvedValue({
      response: "impl output",
      threadId: "thread-2",
      usage: null,
    });
    mockGetDiff.mockResolvedValue({
      ok: false,
      error: new Error("no diff"),
    });
    const state = makeState({ currentPhase: "planned", planOutput: "plan" });
    const service = await createService();
    const result = await service.executeDevelop("ch-1", state);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.diff).toBe("");
    }
  });
});

describe("DevelopService executeTest", () => {
  it("returns error when getDiff fails", async () => {
    mockGetDiff.mockResolvedValue({
      ok: false,
      error: new Error("diff error"),
    });
    const state = makeState({ currentPhase: "developed" });
    const service = await createService();
    const result = await service.executeTest("ch-1", state);
    expect(result.ok).toBe(false);
  });

  it("executes test and returns post-diff", async () => {
    mockGetDiff.mockResolvedValueOnce({ ok: true, value: "pre-diff" });
    mockBuildTestPrompt.mockReturnValue("test prompt");
    mockStartThread.mockResolvedValue({
      response: "test output",
      threadId: "thread-3",
      usage: null,
    });
    mockGetDiff.mockResolvedValueOnce({ ok: true, value: "post-diff" });
    const state = makeState({ currentPhase: "developed" });
    const service = await createService();
    const result = await service.executeTest("ch-1", state);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.response).toBe("test output");
      expect(result.value.diff).toBe("post-diff");
    }
    expect(state.currentPhase).toBe("tested");
  });
});

describe("DevelopService executeCommit", () => {
  it("returns error when getDiff fails", async () => {
    mockGetDiff.mockResolvedValue({
      ok: false,
      error: new Error("no diff"),
    });
    const state = makeState({ currentPhase: "tested" });
    const service = await createService();
    const result = await service.executeCommit("ch-1", state);
    expect(result.ok).toBe(false);
  });

  it("executes commit with issue title fallback", async () => {
    mockGetDiff.mockResolvedValue({ ok: true, value: "some diff" });
    mockGetIssue.mockResolvedValue({
      ok: false,
      error: new Error("not found"),
    });
    mockBuildCommitPrompt.mockReturnValue("commit prompt");
    mockStartThread.mockResolvedValue({
      response: "commit output",
      threadId: "thread-4",
      usage: null,
    });
    const state = makeState({ currentPhase: "tested" });
    const service = await createService();
    const result = await service.executeCommit("ch-1", state);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.response).toBe("commit output");
    }
    expect(mockBuildCommitPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ issueTitle: "Issue #42" }),
    );
    expect(state.currentPhase).toBe("committed");
  });

  it("uses issue title when fetch succeeds", async () => {
    mockGetDiff.mockResolvedValue({ ok: true, value: "some diff" });
    mockGetIssue.mockResolvedValue({
      ok: true,
      value: { number: 42, title: "Real Title", body: "body" },
    });
    mockBuildCommitPrompt.mockReturnValue("commit prompt");
    mockStartThread.mockResolvedValue({
      response: "commit output",
      threadId: "thread-4",
      usage: null,
    });
    const state = makeState({ currentPhase: "tested" });
    const service = await createService();
    const result = await service.executeCommit("ch-1", state);

    expect(result.ok).toBe(true);
    expect(mockBuildCommitPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ issueTitle: "Real Title" }),
    );
  });
});

describe("DevelopService executePr", () => {
  it("returns error when PR creation fails", async () => {
    mockStartThread.mockResolvedValue({
      response: "pushed",
      threadId: "thread-5",
      usage: null,
    });
    mockGetIssue.mockResolvedValue({
      ok: true,
      value: { number: 42, title: "Bug", body: "desc" },
    });
    mockCreatePullRequest.mockResolvedValue({
      ok: false,
      error: new Error("PR failed"),
    });
    const state = makeState({ currentPhase: "committed" });
    const service = await createService();
    const result = await service.executePr("ch-1", state);
    expect(result.ok).toBe(false);
  });

  it("pushes branch and creates PR", async () => {
    mockStartThread.mockResolvedValue({
      response: "pushed",
      threadId: "thread-5",
      usage: null,
    });
    mockGetIssue.mockResolvedValue({
      ok: true,
      value: { number: 42, title: "Bug", body: "desc" },
    });
    mockCreatePullRequest.mockResolvedValue({
      ok: true,
      value: { url: "https://github.com/owner/repo/pull/1", number: 1 },
    });
    const state = makeState({ currentPhase: "committed" });
    const service = await createService();
    const result = await service.executePr("ch-1", state);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prUrl).toBe("https://github.com/owner/repo/pull/1");
    }
    expect(state.currentPhase).toBe("completed");
    expect(mockCompareAndSwapPhase).toHaveBeenCalledWith(
      "ch-1",
      "committed",
      "completed",
    );
  });
});

describe("DevelopService discardChanges", () => {
  it("delegates to workspace manager", async () => {
    mockDiscardChanges.mockResolvedValue({ ok: true, value: undefined });
    const state = makeState();
    const service = await createService();
    const result = await service.discardChanges(state);
    expect(result.ok).toBe(true);
    expect(mockDiscardChanges).toHaveBeenCalledWith("/tmp/ws-42");
  });

  it("returns error on failure", async () => {
    mockDiscardChanges.mockResolvedValue({
      ok: false,
      error: new Error("discard failed"),
    });
    const state = makeState();
    const service = await createService();
    const result = await service.discardChanges(state);
    expect(result.ok).toBe(false);
  });
});
