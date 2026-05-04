import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevelopService } from "@/ai/services/develop.service";
import type { ThreadState } from "@/infrastructure/redis/thread-state.types";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { ValidationError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { PlanCommand } from "./plan.command";

const mockValidateThreadCommand = vi.fn();
const mockSetRunning = vi.fn();
const mockExecutePlan = vi.fn();
const mockSetError = vi.fn();

vi.mock("@/ai/services/develop.service", () => ({
  DevelopService: vi.fn().mockImplementation(() => ({
    validateThreadCommand: mockValidateThreadCommand,
    setRunning: mockSetRunning,
    executePlan: mockExecutePlan,
    setError: mockSetError,
  })),
}));

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/shared/utils/format", () => ({
  formatForDiscord: vi.fn((text: string) => `formatted:${text}`),
}));

// --- Mock factories ---

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

function createCommand(discordClientOverride?: DiscordClient) {
  const developService = {
    validateThreadCommand: mockValidateThreadCommand,
    setRunning: mockSetRunning,
    executePlan: mockExecutePlan,
    setError: mockSetError,
  };
  const discordClient = discordClientOverride ?? createMockDiscordClient();
  const command = new PlanCommand(
    developService as unknown as DevelopService,
    discordClient,
  );
  return { command, developService, discordClient };
}

// --- Tests ---

describe("PlanCommand properties", () => {
  it("has name 'plan'", () => {
    const { command } = createCommand();
    expect(command.name).toBe("plan");
  });

  it("has definition with description", () => {
    const { command } = createCommand();
    expect(command.definition).toEqual({
      description: "Issueに基づいて実装計画を作成",
    });
  });
});

describe("PlanCommand execute - token handling", () => {
  it("returns deferred response on valid token", () => {
    const { command } = createCommand();
    const response = command.execute(createInteraction());

    // DeferredChannelMessageWithSource = 5
    expect(response).resolves.toEqual(expect.objectContaining({ type: 5 }));
  });

  it("returns error when no token", () => {
    const { command } = createCommand();
    const response = command.execute(createInteraction({ raw: {} }));

    // ChannelMessageWithSource = 4
    expect(response).resolves.toEqual(
      expect.objectContaining({
        type: 4,
        data: expect.objectContaining({ flags: 64 }),
      }),
    );
  });
});

describe("PlanCommand execute - thread state validation", () => {
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects if not in a thread channel", async () => {
    discordClient = createMockDiscordClient();
    (
      discordClient.isThreadChannel as ReturnType<typeof vi.fn>
    ).mockResolvedValue(false);

    const { command } = createCommand(discordClient);

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "このコマンドはスレッド内で実行してください。",
    );
  });

  it("rejects if no thread state found", async () => {
    mockValidateThreadCommand.mockResolvedValue(
      err(
        new ValidationError(
          "ワークフローが初期化されていません。先に `/init` を実行してください。",
        ),
      ),
    );

    const { command, discordClient: dc } = createCommand();

    await command.execute(createInteraction());
    await flushPromises();

    expect(dc.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "ワークフローが初期化されていません。先に `/init` を実行してください。",
    );
  });

  it("rejects if wrong user (initiatedBy mismatch)", async () => {
    mockValidateThreadCommand.mockResolvedValue(
      err(new ValidationError("このワークフローの実行者のみが操作できます。")),
    );

    const { command, discordClient: dc } = createCommand();

    await command.execute(createInteraction({ userId: "user-1" }));
    await flushPromises();

    expect(dc.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "このワークフローの実行者のみが操作できます。",
    );
  });

  it("rejects if wrong phase", async () => {
    mockValidateThreadCommand.mockResolvedValue(
      err(
        new ValidationError(
          "現在のフェーズが不正です (現在: developed, 期待: init または planned)",
        ),
      ),
    );

    const { command, discordClient: dc } = createCommand();

    await command.execute(createInteraction());
    await flushPromises();

    expect(dc.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "現在のフェーズが不正です (現在: developed, 期待: init または planned)",
    );
  });

  it("rejects if subStage is running", async () => {
    mockValidateThreadCommand.mockResolvedValue(
      err(
        new ValidationError(
          "現在別の処理が実行中です。完了してから再試行してください。",
        ),
      ),
    );

    const { command, discordClient: dc } = createCommand();

    await command.execute(createInteraction());
    await flushPromises();

    expect(dc.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "現在別の処理が実行中です。完了してから再試行してください。",
    );
  });
});

describe("PlanCommand execute - executePlan failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles executePlan failure and responds with error", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecutePlan.mockResolvedValue(
      err(new ValidationError("GitHub: API rate limit")),
    );

    const { command, discordClient } = createCommand();

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockSetError).toHaveBeenCalledWith(
      "channel-1",
      state,
      "GitHub: API rate limit",
    );

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "GitHub: API rate limit",
    );
  });
});

describe("PlanCommand execute - success flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates, executes plan, responds with formatted response", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecutePlan.mockResolvedValue(ok({ response: "plan response" }));

    const { command, discordClient } = createCommand();

    await command.execute(createInteraction());
    await flushPromises();

    // Verify validateThreadCommand was called
    expect(mockValidateThreadCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "channel-1",
        userId: "user-1",
        expectedPhases: ["init", "planned"],
      }),
    );

    // Verify setRunning was called
    expect(mockSetRunning).toHaveBeenCalledWith("channel-1", state);

    // Verify executePlan was called
    expect(mockExecutePlan).toHaveBeenCalledWith("channel-1", state);

    // Verify discordClient.editInteractionResponse was called with formatted response
    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "formatted:plan response",
    );
  });
});

describe("PlanCommand execute - error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("catches execution errors and responds with error message", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecutePlan.mockRejectedValue(new Error("Codex timeout"));

    const { command, discordClient } = createCommand();

    await command.execute(createInteraction());
    await flushPromises();

    // Verify setError was called
    expect(mockSetError).toHaveBeenCalledWith(
      "channel-1",
      state,
      "Codex timeout",
    );

    // Verify error response was sent
    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "計画の作成中にエラーが発生しました。しばらくしてから再試行してください。",
    );
  });
});
