import { MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevelopService } from "@/ai/services/develop.service";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { AppError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { InitCommand } from "./init.command";

const mockValidateInit = vi.fn();
const mockFetchIssue = vi.fn();
const mockSetupWorkspace = vi.fn();
const mockInitializeState = vi.fn();

vi.mock("@/ai/services/develop.service", () => ({
  DevelopService: vi.fn().mockImplementation(() => ({
    validateInit: mockValidateInit,
    fetchIssue: mockFetchIssue,
    setupWorkspace: mockSetupWorkspace,
    initializeState: mockInitializeState,
  })),
}));

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

function createCommand(discordClientOverride?: DiscordClient) {
  const developService = {
    validateInit: mockValidateInit,
    fetchIssue: mockFetchIssue,
    setupWorkspace: mockSetupWorkspace,
    initializeState: mockInitializeState,
  };
  const discordClient = discordClientOverride ?? createMockDiscordClient();
  const command = new InitCommand(
    developService as unknown as DevelopService,
    discordClient,
  );
  return { command, developService, discordClient };
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
    vi.clearAllMocks();
    ({ command } = createCommand());
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
  let discordClient: DiscordClient;
  let command: InitCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("rejects non-positive issue number", async () => {
    mockValidateInit.mockResolvedValue(
      err(
        new AppError(
          "Issue番号は正の整数で指定してください。",
          "VALIDATION_ERROR",
        ),
      ),
    );

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
    mockValidateInit.mockResolvedValue(
      err(
        new AppError(
          "Issue番号は正の整数で指定してください。",
          "VALIDATION_ERROR",
        ),
      ),
    );

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
    mockValidateInit.mockResolvedValue(
      err(
        new AppError(
          "Issue番号は正の整数で指定してください。",
          "VALIDATION_ERROR",
        ),
      ),
    );

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
    mockValidateInit.mockResolvedValue(
      err(
        new AppError(
          "現在別の処理が実行中です。完了してから再試行してください。",
          "VALIDATION_ERROR",
        ),
      ),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "現在別の処理が実行中です。完了してから再試行してください。",
    );
  });

  it("rejects when different user tries to re-init", async () => {
    mockValidateInit.mockResolvedValue(
      err(
        new AppError(
          "このワークフローは別のユーザーが初期化しました。",
          "VALIDATION_ERROR",
        ),
      ),
    );

    await command.execute(createInteraction({ userId: "user-1" }));
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "このワークフローは別のユーザーが初期化しました。",
    );
  });
});

describe("InitCommand error handling", () => {
  let discordClient: DiscordClient;
  let command: InitCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("handles fetchIssue failure", async () => {
    mockValidateInit.mockResolvedValue(ok(null));
    mockFetchIssue.mockResolvedValue(
      err(new AppError("not found", "NOT_FOUND")),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "Issue #15 の取得に失敗しました: not found",
    );
  });

  it("handles setupWorkspace failure", async () => {
    mockValidateInit.mockResolvedValue(ok(null));
    mockFetchIssue.mockResolvedValue(
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
    );
    mockSetupWorkspace.mockResolvedValue(
      err(new AppError("clone failed", "EXTERNAL_SERVICE_ERROR")),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "ワークスペースの準備に失敗しました: clone failed",
    );
  });

  it("handles unexpected error during setupAndInitialize", async () => {
    mockValidateInit.mockResolvedValue(ok(null));
    mockFetchIssue.mockResolvedValue(
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
    );
    mockSetupWorkspace.mockResolvedValue(
      ok({ branchName: "feature/15", targetDir: "test-repo-15" }),
    );
    mockInitializeState.mockRejectedValue(new Error("redis down"));

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "初期化中にエラーが発生しました。しばらくしてから再試行してください。",
    );
  });
});

describe("InitCommand success flow", () => {
  let discordClient: DiscordClient;
  let command: InitCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("fetches issue, sets up workspace, creates thread, initializes state", async () => {
    mockValidateInit.mockResolvedValue(ok(null));
    mockFetchIssue.mockResolvedValue(
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
    );
    mockSetupWorkspace.mockResolvedValue(
      ok({ branchName: "feature/15", targetDir: "test-repo-15" }),
    );
    mockInitializeState.mockResolvedValue(undefined);

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockFetchIssue).toHaveBeenCalledWith(15);

    expect(mockSetupWorkspace).toHaveBeenCalledWith(15);

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "**Issue #15: Test Issue**\n\nbody",
    );

    expect(discordClient.createThreadFromMessage).toHaveBeenCalledWith(
      "channel-1",
      "msg-id",
      "Issue #15: Test Issue",
    );

    expect(mockInitializeState).toHaveBeenCalledWith({
      channelId: "thread-id",
      userId: "user-1",
      issueNumber: 15,
      branchName: "feature/15",
      targetDir: "test-repo-15",
    });
  });
});
