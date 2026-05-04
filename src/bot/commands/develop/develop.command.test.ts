import { MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevelopService } from "@/ai/services/develop.service";
import type { ThreadState } from "@/infrastructure/redis/thread-state.types";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type { DomainInteraction } from "@/sdk/discord/types/domain";
import { AppError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import { DevelopCommand } from "./develop.command";

const mockValidateThreadCommand = vi.fn();
const mockSetRunning = vi.fn();
const mockExecuteDevelop = vi.fn();
const mockSetError = vi.fn();

vi.mock("@/ai/services/develop.service", () => ({
  DevelopService: vi.fn().mockImplementation(() => ({
    validateThreadCommand: mockValidateThreadCommand,
    setRunning: mockSetRunning,
    executeDevelop: mockExecuteDevelop,
    setError: mockSetError,
  })),
}));

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("@/shared/utils/format", () => ({
  formatForDiscord: vi.fn((text: string) => text),
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

function createCommand(discordClientOverride?: DiscordClient) {
  const developService = {
    validateThreadCommand: mockValidateThreadCommand,
    setRunning: mockSetRunning,
    executeDevelop: mockExecuteDevelop,
    setError: mockSetError,
  };
  const discordClient = discordClientOverride ?? createMockDiscordClient();
  const command = new DevelopCommand(
    developService as unknown as DevelopService,
    discordClient,
  );
  return { command, developService, discordClient };
}

describe("DevelopCommand properties", () => {
  it("has name 'develop'", () => {
    const { command } = createCommand();
    expect(command.name).toBe("develop");
  });

  it("has definition with description", () => {
    const { command } = createCommand();
    expect(command.definition).toEqual({
      description: "計画に基づいてコードを実装",
    });
  });
});

describe("DevelopCommand deferred response", () => {
  let command: DevelopCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command } = createCommand());
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
    vi.clearAllMocks();
    ({ command } = createCommand());
  });

  it("validates thread with expected phase 'planned'", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockValidateThreadCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPhases: ["planned"],
      }),
    );
  });

  it("does nothing when validateThreadCommand returns error (wrong phase)", async () => {
    mockValidateThreadCommand.mockResolvedValue(
      err(new AppError("wrong phase", "VALIDATION_ERROR")),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockExecuteDevelop).not.toHaveBeenCalled();
  });
});

describe("DevelopCommand success flow - full execution", () => {
  let command: DevelopCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command } = createCommand());
  });

  it("executes develop and updates state", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteDevelop.mockResolvedValue(
      ok({ response: "codex response text", diff: "diff content" }),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockSetRunning).toHaveBeenCalledWith("thread-1", state);
    expect(mockExecuteDevelop).toHaveBeenCalledWith("thread-1", state);
  });
});

describe("DevelopCommand success flow - response content", () => {
  let command: DevelopCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("sends diff when diff is available", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteDevelop.mockResolvedValue(
      ok({ response: "codex response text", diff: "diff content" }),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(discordClient.editInteractionResponse).toHaveBeenCalledWith(
      "test-token",
      "**実装完了**\n\n```diff\ndiff content\n```",
    );
  });

  it("uses codex response text when diff is empty", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteDevelop.mockResolvedValue(
      ok({ response: "codex response text", diff: "" }),
    );

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

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command } = createCommand());
  });

  it("handles codex execution failure", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteDevelop.mockRejectedValue(
      new AppError("codex failed", "CODEX_ERROR"),
    );

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockSetError).toHaveBeenCalledWith(
      "thread-1",
      state,
      "codex failed",
    );
  });

  it("handles non-Error thrown value in codex execution", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteDevelop.mockRejectedValue("string error");

    await command.execute(createInteraction());
    await flushPromises();

    expect(mockSetError).toHaveBeenCalledWith(
      "thread-1",
      state,
      "string error",
    );
  });
});

describe("DevelopCommand error handling - discord response", () => {
  let command: DevelopCommand;
  let discordClient: DiscordClient;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ command, discordClient } = createCommand());
  });

  it("sends error message to discord on codex failure", async () => {
    const state = createMockThreadState();
    mockValidateThreadCommand.mockResolvedValue(ok({ state }));
    mockExecuteDevelop.mockRejectedValue(
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
