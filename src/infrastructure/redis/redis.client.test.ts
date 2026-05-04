import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadState } from "./thread-state.types";

const mockConnect = vi.fn();
const mockQuit = vi.fn();
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockSetEx = vi.fn();
const mockDel = vi.fn();
const mockPing = vi.fn();
const mockOn = vi.fn();
const mockHSet = vi.fn();
const mockHGetAll = vi.fn();
const mockEval = vi.fn();
const mockExpire = vi.fn();

vi.mock("redis", () => ({
  createClient: vi.fn().mockReturnValue({
    connect: mockConnect,
    quit: mockQuit,
    get: mockGet,
    set: mockSet,
    setEx: mockSetEx,
    del: mockDel,
    ping: mockPing,
    on: mockOn,
    hSet: mockHSet,
    hGetAll: mockHGetAll,
    eval: mockEval,
    expire: mockExpire,
  }),
}));

const mockLogInfo = vi.fn();
const mockLogWarn = vi.fn();
const mockLogError = vi.fn();
const mockLogDebug = vi.fn();

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: mockLogInfo,
    warn: mockLogWarn,
    error: mockLogError,
    debug: mockLogDebug,
  }),
}));

async function createClient() {
  const { RedisClient } = await import("./redis.client");
  return new RedisClient("redis://localhost:6379");
}

function setupConnectedClient() {
  mockConnect.mockResolvedValue(undefined);
  mockOn.mockReturnValue(undefined);
}

function sampleThreadState(overrides?: Partial<ThreadState>): ThreadState {
  return {
    initiatedBy: "user-123",
    issueNumber: 12,
    repo: "owner/repo",
    branch: "feature/12",
    workspacePath: "/tmp/workspace",
    currentPhase: "init",
    subStage: "idle",
    lastError: null,
    planOutput: null,
    ...overrides,
  };
}

describe("RedisClient connect success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
  });

  it("connects and sets isConnected to true", async () => {
    const client = await createClient();
    await client.connect();
    expect(client.isConnected).toBe(true);
  });

  it("logs info on successful connection", async () => {
    const client = await createClient();
    await client.connect();
    expect(mockLogInfo).toHaveBeenCalledWith(
      { url: "redis://localhost:6379" },
      "Redis connected",
    );
  });

  it("registers error event handler", async () => {
    const client = await createClient();
    await client.connect();
    expect(mockOn).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("registers reconnecting event handler", async () => {
    const client = await createClient();
    await client.connect();
    expect(mockOn).toHaveBeenCalledWith("reconnecting", expect.any(Function));
  });

  it("registers ready event handler", async () => {
    const client = await createClient();
    await client.connect();
    expect(mockOn).toHaveBeenCalledWith("ready", expect.any(Function));
  });
});

describe("RedisClient connect failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));
    mockOn.mockReturnValue(undefined);
  });

  it("falls back on connection failure", async () => {
    const client = await createClient();
    await client.connect();
    expect(client.isConnected).toBe(false);
  });

  it("logs warn on connection failure", async () => {
    const client = await createClient();
    await client.connect();
    expect(mockLogWarn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Redis connection failed, falling back to in-memory",
    );
  });
});

describe("RedisClient error event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
  });

  it("sets connected to false on error event", async () => {
    const client = await createClient();
    await client.connect();
    expect(client.isConnected).toBe(true);
    const errorHandler = mockOn.mock.calls.find(
      (c: string[]) => c[0] === "error",
    )?.[1];
    errorHandler?.(new Error("connection lost"));
    expect(client.isConnected).toBe(false);
  });

  it("logs error on error event", async () => {
    const client = await createClient();
    await client.connect();
    const errorHandler = mockOn.mock.calls.find(
      (c: string[]) => c[0] === "error",
    )?.[1];
    errorHandler?.(new Error("connection lost"));
    expect(mockLogError).toHaveBeenCalledWith(
      { err: "connection lost" },
      "Redis error",
    );
  });
});

describe("RedisClient reconnecting event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
  });

  it("logs warn on reconnecting event", async () => {
    const client = await createClient();
    await client.connect();
    const reconnectingHandler = mockOn.mock.calls.find(
      (c: string[]) => c[0] === "reconnecting",
    )?.[1];
    reconnectingHandler?.();
    expect(mockLogWarn).toHaveBeenCalledWith("Redis reconnecting...");
  });
});

describe("RedisClient ready event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
  });

  it("sets connected to true on ready event", async () => {
    const client = await createClient();
    await client.connect();
    const errorHandler = mockOn.mock.calls.find(
      (c: string[]) => c[0] === "error",
    )?.[1];
    errorHandler?.(new Error("connection lost"));
    expect(client.isConnected).toBe(false);
    const readyHandler = mockOn.mock.calls.find(
      (c: string[]) => c[0] === "ready",
    )?.[1];
    readyHandler?.();
    expect(client.isConnected).toBe(true);
  });

  it("logs info on ready event", async () => {
    const client = await createClient();
    await client.connect();
    const readyHandler = mockOn.mock.calls.find(
      (c: string[]) => c[0] === "ready",
    )?.[1];
    readyHandler?.();
    expect(mockLogInfo).toHaveBeenCalledWith("Redis reconnected and ready");
  });
});

describe("RedisClient disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockQuit.mockResolvedValue(undefined);
  });

  it("disconnects connected client", async () => {
    const client = await createClient();
    await client.connect();
    await client.disconnect();
    expect(client.isConnected).toBe(false);
  });

  it("calls quit on the redis client", async () => {
    const client = await createClient();
    await client.connect();
    await client.disconnect();
    expect(mockQuit).toHaveBeenCalled();
  });

  it("is no-op when not connected", async () => {
    const client = await createClient();
    await client.disconnect();
    expect(mockQuit).not.toHaveBeenCalled();
  });

  it("cleans up when quit throws", async () => {
    mockQuit.mockRejectedValue(new Error("already closed"));
    const client = await createClient();
    await client.connect();
    await client.disconnect();
    expect(client.isConnected).toBe(false);
  });

  it("logs info when quit throws", async () => {
    mockQuit.mockRejectedValue(new Error("already closed"));
    const client = await createClient();
    await client.connect();
    await client.disconnect();
    expect(mockLogInfo).toHaveBeenCalledWith("Redis disconnected");
  });
});

describe("RedisClient get from redis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockGet.mockResolvedValue("value-from-redis");
    mockSet.mockResolvedValue("OK");
  });

  it("returns value from redis when connected", async () => {
    const client = await createClient();
    await client.connect();
    expect(await client.get("key")).toBe("value-from-redis");
  });

  it("returns null for missing key from redis", async () => {
    mockGet.mockResolvedValue(null);
    const client = await createClient();
    await client.connect();
    expect(await client.get("missing")).toBeNull();
  });

  it("falls back when redis throws", async () => {
    mockSet.mockRejectedValue(new Error("redis error"));
    mockGet.mockRejectedValue(new Error("redis error"));
    const client = await createClient();
    await client.connect();
    await client.set("key", "fallback-value");
    expect(await client.get("key")).toBe("fallback-value");
  });
});

describe("RedisClient get fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns value from fallback when not connected", async () => {
    const client = await createClient();
    await client.set("key", "in-memory-value");
    expect(await client.get("key")).toBe("in-memory-value");
  });

  it("returns null for missing fallback key", async () => {
    const client = await createClient();
    expect(await client.get("nonexistent")).toBeNull();
  });

  it("returns null and deletes expired entry", async () => {
    vi.useFakeTimers();
    const client = await createClient();
    await client.set("key", "value", { ttlMs: 1000 });
    vi.advanceTimersByTime(1001);
    expect(await client.get("key")).toBeNull();
    vi.useRealTimers();
  });
});

describe("RedisClient set to redis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockSet.mockResolvedValue("OK");
    mockSetEx.mockResolvedValue("OK");
  });

  it("calls client.set without TTL", async () => {
    const client = await createClient();
    await client.connect();
    await client.set("key", "value");
    expect(mockSet).toHaveBeenCalledWith("key", "value");
  });

  it("calls client.setEx with TTL in seconds", async () => {
    const client = await createClient();
    await client.connect();
    await client.set("key", "value", { ttlMs: 5000 });
    expect(mockSetEx).toHaveBeenCalledWith("key", 5, "value");
  });

  it("falls back when redis throws on set", async () => {
    mockSet.mockRejectedValue(new Error("redis error"));
    const client = await createClient();
    await client.connect();
    await client.set("key", "fallback-value");
    expect(await client.get("key")).toBe("fallback-value");
  });

  it("calls client.set instead of setEx when ttlMs is 0", async () => {
    const client = await createClient();
    await client.connect();
    await client.set("key", "value", { ttlMs: 0 });
    expect(mockSet).toHaveBeenCalledWith("key", "value");
    expect(mockSetEx).not.toHaveBeenCalled();
  });
});

describe("RedisClient set fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores in fallback when not connected", async () => {
    const client = await createClient();
    await client.set("key", "value");
    expect(await client.get("key")).toBe("value");
  });
});

describe("RedisClient delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockSet.mockResolvedValue("OK");
    mockDel.mockResolvedValue(1);
  });

  it("deletes from redis and fallback when connected", async () => {
    const client = await createClient();
    await client.connect();
    await client.set("key", "value");
    await client.delete("key");
    expect(mockDel).toHaveBeenCalledWith("key");
    expect(await client.get("key")).toBeNull();
  });

  it("deletes from fallback only when not connected", async () => {
    const client = await createClient();
    await client.set("key", "value");
    await client.delete("key");
    expect(await client.get("key")).toBeNull();
  });

  it("does not throw on non-existent key", async () => {
    const client = await createClient();
    await expect(client.delete("nonexistent")).resolves.toBeUndefined();
  });

  it("still deletes from fallback when redis del throws", async () => {
    mockDel.mockRejectedValue(new Error("redis error"));
    const client = await createClient();
    await client.connect();
    await client.set("key", "value");
    await client.delete("key");
    expect(await client.get("key")).toBeNull();
  });
});

describe("RedisClient ping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockPing.mockResolvedValue("PONG");
  });

  it("returns true when connected and PONG received", async () => {
    const client = await createClient();
    await client.connect();
    expect(await client.ping()).toBe(true);
  });

  it("returns false when not connected", async () => {
    const client = await createClient();
    expect(await client.ping()).toBe(false);
  });

  it("returns false when ping throws", async () => {
    mockPing.mockRejectedValue(new Error("timeout"));
    const client = await createClient();
    await client.connect();
    expect(await client.ping()).toBe(false);
  });
});

describe("RedisClient isConnected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockQuit.mockResolvedValue(undefined);
  });

  it("returns false initially", async () => {
    const client = await createClient();
    expect(client.isConnected).toBe(false);
  });

  it("returns true after connect", async () => {
    const client = await createClient();
    await client.connect();
    expect(client.isConnected).toBe(true);
  });

  it("returns false after disconnect", async () => {
    const client = await createClient();
    await client.connect();
    await client.disconnect();
    expect(client.isConnected).toBe(false);
  });
});

describe("RedisClient fallback TTL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns value before expiry", async () => {
    vi.useFakeTimers();
    const client = await createClient();
    await client.set("key", "value", { ttlMs: 10000 });
    vi.advanceTimersByTime(5000);
    expect(await client.get("key")).toBe("value");
  });

  it("returns null after expiry", async () => {
    vi.useFakeTimers();
    const client = await createClient();
    await client.set("key", "value", { ttlMs: 1000 });
    vi.advanceTimersByTime(1001);
    expect(await client.get("key")).toBeNull();
  });

  it("keeps permanent entry without TTL", async () => {
    vi.useFakeTimers();
    const client = await createClient();
    await client.set("key", "value");
    vi.advanceTimersByTime(86400000);
    expect(await client.get("key")).toBe("value");
  });
});

describe("RedisClient setEx TTL boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockSetEx.mockResolvedValue("OK");
  });

  it("ceils ttlMs 1 to 1 second", async () => {
    const client = await createClient();
    await client.connect();
    await client.set("key", "value", { ttlMs: 1 });
    expect(mockSetEx).toHaveBeenCalledWith("key", 1, "value");
  });

  it("ceils ttlMs 999 to 1 second", async () => {
    const client = await createClient();
    await client.connect();
    await client.set("key", "value", { ttlMs: 999 });
    expect(mockSetEx).toHaveBeenCalledWith("key", 1, "value");
  });

  it("ceils ttlMs 1001 to 2 seconds", async () => {
    const client = await createClient();
    await client.connect();
    await client.set("key", "value", { ttlMs: 1001 });
    expect(mockSetEx).toHaveBeenCalledWith("key", 2, "value");
  });
});

// --- ThreadState tests ---

describe("RedisClient saveThreadState / getThreadState (Redis)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockHSet.mockResolvedValue(8);
    mockHGetAll.mockResolvedValue({
      initiatedBy: "user-123",
      issueNumber: "12",
      repo: "owner/repo",
      branch: "feature/12",
      workspacePath: "/tmp/workspace",
      currentPhase: "init",
      subStage: "idle",
      lastError: "",
      planOutput: "",
    });
  });

  it("saves state via hSet", async () => {
    const client = await createClient();
    await client.connect();
    await client.saveThreadState("thread-1", sampleThreadState());
    expect(mockHSet).toHaveBeenCalledWith("codex:develop:thread-1", {
      initiatedBy: "user-123",
      issueNumber: "12",
      repo: "owner/repo",
      branch: "feature/12",
      workspacePath: "/tmp/workspace",
      currentPhase: "init",
      subStage: "idle",
      lastError: "",
      planOutput: "",
    });
  });

  it("gets state via hGetAll", async () => {
    const client = await createClient();
    await client.connect();
    const state = await client.getThreadState("thread-1");
    expect(state).toEqual(sampleThreadState());
  });

  it("returns null for non-existent threadId", async () => {
    mockHGetAll.mockResolvedValue({});
    const client = await createClient();
    await client.connect();
    const state = await client.getThreadState("nonexistent");
    expect(state).toBeNull();
  });
});

describe("RedisClient saveThreadState / getThreadState (fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves and retrieves state in fallback", async () => {
    const client = await createClient();
    await client.saveThreadState("thread-1", sampleThreadState());
    const state = await client.getThreadState("thread-1");
    expect(state).toEqual(sampleThreadState());
  });

  it("returns null for non-existent threadId in fallback", async () => {
    const client = await createClient();
    const state = await client.getThreadState("nonexistent");
    expect(state).toBeNull();
  });

  it("preserves all fields in fallback round-trip", async () => {
    const state = sampleThreadState({
      currentPhase: "developed",
      subStage: "running",
      lastError: "something failed",
      planOutput: "plan text",
    });
    const client = await createClient();
    await client.saveThreadState("thread-2", state);
    const result = await client.getThreadState("thread-2");
    expect(result).toEqual(state);
  });
});

describe("RedisClient saveThreadState / getThreadState (Redis exception → fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockHSet.mockRejectedValue(new Error("redis error"));
    mockHGetAll.mockRejectedValue(new Error("redis error"));
  });

  it("falls back to in-memory when hSet throws", async () => {
    const client = await createClient();
    await client.connect();
    await client.saveThreadState("thread-1", sampleThreadState());
    const state = await client.getThreadState("thread-1");
    expect(state).toEqual(sampleThreadState());
  });
});

describe("RedisClient compareAndSwapPhase (Redis)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockEval.mockResolvedValue(1);
  });

  it("returns true on successful CAS (init → planned)", async () => {
    const client = await createClient();
    await client.connect();
    const result = await client.compareAndSwapPhase(
      "thread-1",
      "init",
      "planned",
    );
    expect(result).toBe(true);
  });

  it("calls eval with correct arguments", async () => {
    const client = await createClient();
    await client.connect();
    await client.compareAndSwapPhase("thread-1", "init", "planned");
    expect(mockEval).toHaveBeenCalledWith(expect.stringContaining("HGET"), {
      keys: ["codex:develop:thread-1"],
      arguments: ["init", "planned"],
    });
  });

  it("returns false when CAS fails (phase mismatch)", async () => {
    mockEval.mockResolvedValue(0);
    const client = await createClient();
    await client.connect();
    const result = await client.compareAndSwapPhase(
      "thread-1",
      "init",
      "planned",
    );
    expect(result).toBe(false);
  });
});

describe("RedisClient compareAndSwapPhase (fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true and updates phase on successful CAS", async () => {
    const client = await createClient();
    await client.saveThreadState(
      "thread-1",
      sampleThreadState({ currentPhase: "init", subStage: "done" }),
    );
    const result = await client.compareAndSwapPhase(
      "thread-1",
      "init",
      "planned",
    );
    expect(result).toBe(true);
    const state = await client.getThreadState("thread-1");
    expect(state?.currentPhase).toBe("planned");
    expect(state?.subStage).toBe("idle");
  });

  it("returns false when current phase does not match expected", async () => {
    const client = await createClient();
    await client.saveThreadState(
      "thread-1",
      sampleThreadState({ currentPhase: "planned" }),
    );
    const result = await client.compareAndSwapPhase(
      "thread-1",
      "init",
      "developed",
    );
    expect(result).toBe(false);
    const state = await client.getThreadState("thread-1");
    expect(state?.currentPhase).toBe("planned");
  });

  it("returns false when state does not exist", async () => {
    const client = await createClient();
    const result = await client.compareAndSwapPhase(
      "nonexistent",
      "init",
      "planned",
    );
    expect(result).toBe(false);
  });
});

describe("RedisClient compareAndSwapPhase (Redis exception → fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockHSet.mockRejectedValue(new Error("redis error"));
    mockHGetAll.mockRejectedValue(new Error("redis error"));
    mockEval.mockRejectedValue(new Error("redis error"));
  });

  it("falls back to in-memory CAS when eval throws", async () => {
    const client = await createClient();
    await client.connect();
    await client.saveThreadState(
      "thread-1",
      sampleThreadState({ currentPhase: "init" }),
    );
    const result = await client.compareAndSwapPhase(
      "thread-1",
      "init",
      "planned",
    );
    expect(result).toBe(true);
    const state = await client.getThreadState("thread-1");
    expect(state?.currentPhase).toBe("planned");
  });
});

describe("RedisClient codex thread ID (Redis)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockSet.mockResolvedValue("OK");
    mockGet.mockResolvedValue("codex-thread-123");
  });

  it("saves and retrieves codex thread ID", async () => {
    const client = await createClient();
    await client.connect();
    await client.saveCodexThread("thread-1", "plan", "codex-thread-123");
    const result = await client.getCodexThread("thread-1", "plan");
    expect(result).toBe("codex-thread-123");
  });

  it("returns null for non-existent phase", async () => {
    mockGet.mockResolvedValue(null);
    const client = await createClient();
    await client.connect();
    const result = await client.getCodexThread("thread-1", "develop");
    expect(result).toBeNull();
  });
});

describe("RedisClient codex thread ID (fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves and retrieves codex thread ID in fallback", async () => {
    const client = await createClient();
    await client.saveCodexThread("thread-1", "plan", "codex-thread-456");
    const result = await client.getCodexThread("thread-1", "plan");
    expect(result).toBe("codex-thread-456");
  });

  it("returns null for non-existent phase in fallback", async () => {
    const client = await createClient();
    const result = await client.getCodexThread("thread-1", "plan");
    expect(result).toBeNull();
  });
});

describe("RedisClient saveCodexThread / getCodexThread (Redis exception → fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockSet.mockRejectedValue(new Error("redis error"));
    mockGet.mockRejectedValue(new Error("redis error"));
  });

  it("falls back to in-memory when set throws", async () => {
    const client = await createClient();
    await client.connect();
    await client.saveCodexThread("thread-1", "plan", "codex-123");
    const result = await client.getCodexThread("thread-1", "plan");
    expect(result).toBe("codex-123");
  });

  it("returns null when get throws and no fallback exists", async () => {
    const client = await createClient();
    await client.connect();
    const result = await client.getCodexThread("thread-1", "plan");
    expect(result).toBeNull();
  });
});

describe("RedisClient setThreadTTL (Redis)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockExpire.mockResolvedValue(true);
  });

  it("sets TTL on thread key and codex sub-keys", async () => {
    const client = await createClient();
    await client.connect();
    await client.setThreadTTL("thread-1", 3600);
    expect(mockExpire).toHaveBeenCalledWith("codex:develop:thread-1", 3600);
    expect(mockExpire).toHaveBeenCalledWith(
      "codex:develop:thread-1/plan",
      3600,
    );
    expect(mockExpire).toHaveBeenCalledWith(
      "codex:develop:thread-1/develop",
      3600,
    );
    expect(mockExpire).toHaveBeenCalledWith(
      "codex:develop:thread-1/test",
      3600,
    );
    expect(mockExpire).toHaveBeenCalledWith(
      "codex:develop:thread-1/commit",
      3600,
    );
  });
});

describe("RedisClient setThreadTTL (fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates expiresAt on fallback hash entry", async () => {
    vi.useFakeTimers();
    const client = await createClient();
    await client.saveThreadState("thread-1", sampleThreadState());
    await client.setThreadTTL("thread-1", 3600);
    vi.advanceTimersByTime(3600 * 1000 + 1);
    const state = await client.getThreadState("thread-1");
    expect(state).toBeNull();
  });

  it("does nothing when fallback entry does not exist", async () => {
    const client = await createClient();
    await client.setThreadTTL("nonexistent", 3600);
    const state = await client.getThreadState("nonexistent");
    expect(state).toBeNull();
  });
});

describe("RedisClient planOutput 10KB truncation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("truncates planOutput exceeding 10KB", async () => {
    const oversized = "a".repeat(11_000);
    const client = await createClient();
    await client.saveThreadState(
      "thread-1",
      sampleThreadState({ planOutput: oversized }),
    );
    const state = await client.getThreadState("thread-1");
    expect(state).not.toBeNull();
    expect(state?.planOutput).not.toBeNull();
    const output = state?.planOutput ?? "";
    expect(Buffer.byteLength(output, "utf-8")).toBeLessThanOrEqual(10_240);
  });

  it("logs warning on truncation", async () => {
    const oversized = "a".repeat(11_000);
    const client = await createClient();
    await client.saveThreadState(
      "thread-1",
      sampleThreadState({ planOutput: oversized }),
    );
    expect(mockLogWarn).toHaveBeenCalledWith(
      {
        threadId: "thread-1",
        originalBytes: expect.any(Number),
        maxBytes: 10_240,
      },
      "planOutput exceeds 10KB, truncating",
    );
  });

  it("does not truncate planOutput within 10KB", async () => {
    const within = "a".repeat(10_240);
    const client = await createClient();
    await client.saveThreadState(
      "thread-1",
      sampleThreadState({ planOutput: within }),
    );
    const state = await client.getThreadState("thread-1");
    expect(state?.planOutput).toBe(within);
    expect(mockLogWarn).not.toHaveBeenCalledWith(
      expect.objectContaining({}),
      "planOutput exceeds 10KB, truncating",
    );
  });

  it("truncates planOutput at exactly 10241 bytes", async () => {
    const atBoundary = "a".repeat(10_241);
    const client = await createClient();
    await client.saveThreadState(
      "thread-1",
      sampleThreadState({ planOutput: atBoundary }),
    );
    const state = await client.getThreadState("thread-1");
    expect(state).not.toBeNull();
    expect(state?.planOutput).not.toBeNull();
    expect(
      Buffer.byteLength(state?.planOutput ?? "", "utf-8"),
    ).toBeLessThanOrEqual(10_240);
  });
});

describe("RedisClient deleteThreadState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockDel.mockResolvedValue(1);
  });

  it("deletes thread state and codex sub-keys via Redis", async () => {
    const client = await createClient();
    await client.connect();
    await client.deleteThreadState("thread-1");
    expect(mockDel).toHaveBeenCalledWith("codex:develop:thread-1");
    expect(mockDel).toHaveBeenCalledWith("codex:develop:thread-1/plan");
    expect(mockDel).toHaveBeenCalledWith("codex:develop:thread-1/develop");
    expect(mockDel).toHaveBeenCalledWith("codex:develop:thread-1/test");
    expect(mockDel).toHaveBeenCalledWith("codex:develop:thread-1/commit");
  });

  it("deletes from fallback", async () => {
    const client = await createClient();
    await client.saveThreadState("thread-1", sampleThreadState());
    await client.saveCodexThread("thread-1", "plan", "codex-123");
    await client.deleteThreadState("thread-1");
    expect(await client.getThreadState("thread-1")).toBeNull();
    expect(await client.getCodexThread("thread-1", "plan")).toBeNull();
  });
});

describe("RedisClient deleteThreadState (Redis exception → fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
    mockHSet.mockRejectedValue(new Error("redis error"));
    mockHGetAll.mockRejectedValue(new Error("redis error"));
    mockDel.mockRejectedValue(new Error("redis error"));
    mockSet.mockRejectedValue(new Error("redis error"));
    mockGet.mockRejectedValue(new Error("redis error"));
  });

  it("deletes from fallback when Redis del throws", async () => {
    const client = await createClient();
    await client.connect();
    await client.saveThreadState("thread-1", sampleThreadState());
    await client.saveCodexThread("thread-1", "plan", "codex-123");
    await client.deleteThreadState("thread-1");
    expect(await client.getThreadState("thread-1")).toBeNull();
    expect(await client.getCodexThread("thread-1", "plan")).toBeNull();
  });
});

describe("RedisClient fallback consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("full lifecycle: save → get → CAS → delete", async () => {
    const client = await createClient();
    await client.saveThreadState("thread-1", sampleThreadState());
    let state = await client.getThreadState("thread-1");
    expect(state?.currentPhase).toBe("init");

    const casResult = await client.compareAndSwapPhase(
      "thread-1",
      "init",
      "planned",
    );
    expect(casResult).toBe(true);
    state = await client.getThreadState("thread-1");
    expect(state?.currentPhase).toBe("planned");
    expect(state?.subStage).toBe("idle");

    await client.deleteThreadState("thread-1");
    state = await client.getThreadState("thread-1");
    expect(state).toBeNull();
  });

  it("codex thread IDs survive across phases in fallback", async () => {
    const client = await createClient();
    await client.saveCodexThread("thread-1", "plan", "codex-plan");
    await client.saveCodexThread("thread-1", "develop", "codex-dev");
    expect(await client.getCodexThread("thread-1", "plan")).toBe("codex-plan");
    expect(await client.getCodexThread("thread-1", "develop")).toBe(
      "codex-dev",
    );
  });
});

// --- Default TTL tests ---

describe("RedisClient default TTL for saveThreadState fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires fallback entry after 24h by default", async () => {
    vi.useFakeTimers();
    const client = await createClient();
    await client.saveThreadState("thread-1", sampleThreadState());
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    const state = await client.getThreadState("thread-1");
    expect(state).toBeNull();
  });

  it("allows setThreadTTL to override default expiresAt", async () => {
    vi.useFakeTimers();
    const client = await createClient();
    await client.saveThreadState("thread-1", sampleThreadState());
    await client.setThreadTTL("thread-1", 3600);
    vi.advanceTimersByTime(3600 * 1000 + 1);
    const state = await client.getThreadState("thread-1");
    expect(state).toBeNull();
  });
});

describe("RedisClient default TTL for saveCodexThread fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires fallback entry after 24h by default", async () => {
    vi.useFakeTimers();
    const client = await createClient();
    await client.saveCodexThread("thread-1", "plan", "codex-123");
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    const result = await client.getCodexThread("thread-1", "plan");
    expect(result).toBeNull();
  });
});

// --- Reconnection fallback cleanup tests ---

describe("RedisClient reconnection fallback cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupConnectedClient();
  });

  it("clears fallback data on reconnect", async () => {
    const client = await createClient();
    await client.connect();
    const errorHandler = mockOn.mock.calls.find(
      (c: string[]) => c[0] === "error",
    )?.[1];
    errorHandler?.(new Error("connection lost"));

    await client.set("key1", "value1");
    await client.saveThreadState("thread-1", sampleThreadState());

    const readyHandler = mockOn.mock.calls.find(
      (c: string[]) => c[0] === "ready",
    )?.[1];
    readyHandler?.();

    expect(await client.get("key1")).toBeNull();
  });

  it("logs warning with discarded entry count on reconnect", async () => {
    const client = await createClient();
    await client.connect();
    const errorHandler = mockOn.mock.calls.find(
      (c: string[]) => c[0] === "error",
    )?.[1];
    errorHandler?.(new Error("connection lost"));

    await client.set("key1", "value1");
    await client.saveThreadState("thread-1", sampleThreadState());

    mockLogWarn.mockClear();
    const readyHandler = mockOn.mock.calls.find(
      (c: string[]) => c[0] === "ready",
    )?.[1];
    readyHandler?.();

    expect(mockLogWarn).toHaveBeenCalledWith(
      { discardedEntries: expect.any(Number) },
      "Redis reconnected, discarding fallback data",
    );
  });
});

// --- Periodic cleanup tests ---

describe("RedisClient periodic fallback cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));
    mockOn.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("purges expired entries on timer tick", async () => {
    vi.useFakeTimers();
    const client = await createClient();
    await client.connect();
    await client.set("key1", "value1", { ttlMs: 1000 });
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(await client.get("key1")).toBeNull();
  });
});

// --- Fallback capacity tests ---

describe("RedisClient fallback capacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("evicts oldest entries when exceeding capacity", async () => {
    const client = await createClient();
    const promises = Array.from({ length: 510 }, (_, i) =>
      client.set(`key-${i}`, `value-${i}`),
    );
    await Promise.all(promises);
    expect(await client.get("key-0")).toBeNull();
    expect(await client.get("key-509")).toBe("value-509");
  });

  it("evicts expired entries first", async () => {
    vi.useFakeTimers();
    const client = await createClient();
    const promises = Array.from({ length: 500 }, (_, i) =>
      client.set(`key-${i}`, `value-${i}`, { ttlMs: 1000 }),
    );
    await Promise.all(promises);
    vi.advanceTimersByTime(1001);
    await client.set("key-new", "value-new");
    expect(await client.get("key-0")).toBeNull();
    expect(await client.get("key-new")).toBe("value-new");
    vi.useRealTimers();
  });
});

// --- Fallback monitoring tests ---

describe("RedisClient fallback monitoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs debug when fallback has entries", async () => {
    const client = await createClient();
    await client.set("key1", "value1");
    expect(mockLogDebug).toHaveBeenCalledWith(
      { fallbackSize: expect.any(Number) },
      "Fallback memory usage",
    );
  });

  it("logs warn when fallback size exceeds 100", async () => {
    const client = await createClient();
    const promises = Array.from({ length: 101 }, (_, i) =>
      client.set(`key-${i}`, `value-${i}`),
    );
    await Promise.all(promises);
    expect(mockLogWarn).toHaveBeenCalledWith(
      {
        fallbackSize: expect.any(Number),
        fallbackMap: expect.any(Number),
        fallbackHashMap: expect.any(Number),
      },
      "Fallback memory usage exceeds threshold",
    );
  });
});
