import { MessageFlags } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DomainInteraction,
  DomainResponse,
} from "@/sdk/discord/types/domain";
import type { Command } from "../commands/command.interface";
import { Router } from "../router";
import { InteractionHandler } from "./interaction.handler";

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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
    commandName: "ping",
    raw: {},
    ...overrides,
  };
}

function createMockCommand(name: string, response?: DomainResponse): Command {
  return {
    name,
    execute: vi
      .fn()
      .mockResolvedValue(response ?? { type: 4, data: { content: "result" } }),
  };
}

describe("InteractionHandler PING handling", () => {
  let router: Router;
  let handler: InteractionHandler;

  beforeEach(() => {
    router = new Router([]);
    handler = new InteractionHandler(router);
  });

  it("returns pong response for ping type", async () => {
    const response = await handler.handle(createInteraction({ type: "ping" }));

    expect(response.type).toBe(1);
  });

  it("does not call router.resolve for ping", async () => {
    const resolveSpy = vi.spyOn(router, "resolve");

    await handler.handle(createInteraction({ type: "ping" }));

    expect(resolveSpy).not.toHaveBeenCalled();
  });
});

describe("InteractionHandler command routing", () => {
  let router: Router;
  let handler: InteractionHandler;

  beforeEach(() => {
    router = new Router([]);
    handler = new InteractionHandler(router);
  });

  it("delegates to resolved command execute", async () => {
    const mockCommand = createMockCommand("ping");
    router = new Router([mockCommand]);
    handler = new InteractionHandler(router);

    await handler.handle(createInteraction({ commandName: "ping" }));

    expect(mockCommand.execute).toHaveBeenCalledTimes(1);
  });

  it("returns the result of command execute", async () => {
    const expectedResponse: DomainResponse = {
      type: 4,
      data: { content: "Pong!" },
    };
    const mockCommand = createMockCommand("ping", expectedResponse);
    router = new Router([mockCommand]);
    handler = new InteractionHandler(router);

    const response = await handler.handle(
      createInteraction({ commandName: "ping" }),
    );

    expect(response).toBe(expectedResponse);
  });
});

describe("InteractionHandler command not found", () => {
  let router: Router;
  let handler: InteractionHandler;

  beforeEach(() => {
    router = new Router([]);
    handler = new InteractionHandler(router);
  });

  it("returns ephemeral error for unknown command", async () => {
    const response = await handler.handle(
      createInteraction({ commandName: "unknown" }),
    );

    expect(response.type).toBe(4);
    expect(response.data?.content).toBe("不明なコマンドです");
    expect(response.data?.flags).toBe(MessageFlags.Ephemeral);
  });

  it("handles commandName undefined as not found", async () => {
    const response = await handler.handle(
      createInteraction({ commandName: undefined }),
    );

    expect(response.data?.content).toBe("不明なコマンドです");
  });
});

describe("InteractionHandler command execution error", () => {
  it("returns ephemeral error when command.execute throws", async () => {
    const mockCommand = createMockCommand("ping");
    (mockCommand.execute as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("unexpected"),
    );
    const router = new Router([mockCommand]);
    const handler = new InteractionHandler(router);

    const response = await handler.handle(
      createInteraction({ commandName: "ping" }),
    );

    expect(response.type).toBe(4);
    expect(response.data?.content).toBe(
      "エラーが発生しました。しばらくしてからお試しください。",
    );
    expect(response.data?.flags).toBe(MessageFlags.Ephemeral);
  });
});
