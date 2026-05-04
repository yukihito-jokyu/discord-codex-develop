import { createClient, type RedisClientType } from "redis";
import {
  PLAN_OUTPUT_MAX_BYTES,
  THREAD_SESSION_TTL_S,
} from "@/shared/utils/constants";
import { getLogger } from "@/shared/utils/logger";
import type { Phase, ThreadState } from "./thread-state.types";

type FallbackEntry = { value: string; expiresAt?: number };

export class RedisClient {
  private client: RedisClientType | null = null;
  private fallback = new Map<string, FallbackEntry>();
  private fallbackHash = new Map<
    string,
    { state: ThreadState; expiresAt?: number }
  >();
  private connected = false;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private static readonly FALLBACK_MAX_SIZE = 500;

  private static readonly CAS_SCRIPT = [
    "local current = redis.call('HGET', KEYS[1], 'currentPhase')",
    "if current == ARGV[1] then",
    "  redis.call('HSET', KEYS[1], 'currentPhase', ARGV[2], 'subStage', 'idle')",
    "  return 1",
    "else",
    "  return 0",
    "end",
  ].join("\n");

  constructor(private url: string) {}

  async connect(): Promise<void> {
    try {
      this.client = createClient({ url: this.url });
      this.client.on("error", (err) => {
        getLogger().error({ err: err.message }, "Redis error");
        this.connected = false;
      });
      this.client.on("reconnecting", () => {
        getLogger().warn("Redis reconnecting...");
      });
      this.client.on("ready", () => {
        const fallbackCount = this.fallback.size + this.fallbackHash.size;
        if (fallbackCount > 0) {
          getLogger().warn(
            { discardedEntries: fallbackCount },
            "Redis reconnected, discarding fallback data",
          );
        }
        this.fallback.clear();
        this.fallbackHash.clear();
        this.stopFallbackCleanup();
        this.connected = true;
        getLogger().info("Redis reconnected and ready");
      });
      await this.client.connect();
      this.connected = true;
      getLogger().info({ url: this.url }, "Redis connected");
    } catch (err) {
      getLogger().warn(
        { err },
        "Redis connection failed, falling back to in-memory",
      );
      this.client = null;
      this.connected = false;
      this.startFallbackCleanup();
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // 接続が既に切断されている場合は無視
      } finally {
        this.client = null;
        this.connected = false;
        this.stopFallbackCleanup();
        this.fallback.clear();
        this.fallbackHash.clear();
        getLogger().info("Redis disconnected");
      }
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.client && this.connected) {
      try {
        return await this.client.get(key);
      } catch {
        getLogger().debug({ key }, "get failed, using fallback");
        return this.fallbackGet(key);
      }
    }
    return this.fallbackGet(key);
  }

  async set(
    key: string,
    value: string,
    opts?: { ttlMs?: number },
  ): Promise<void> {
    if (this.client && this.connected) {
      try {
        if (opts?.ttlMs) {
          await this.client.setEx(key, Math.ceil(opts.ttlMs / 1000), value);
        } else {
          await this.client.set(key, value);
        }
        return;
      } catch {
        getLogger().debug({ key }, "set failed, using fallback");
      }
    }
    this.ensureFallbackCapacity();
    this.fallback.set(key, {
      value,
      expiresAt: opts?.ttlMs ? Date.now() + opts.ttlMs : undefined,
    });
    this.logFallbackSize();
  }

  async delete(key: string): Promise<void> {
    if (this.client && this.connected) {
      try {
        await this.client.del(key);
      } catch {
        getLogger().debug({ key }, "delete failed, using fallback");
      }
    }
    this.fallback.delete(key);
  }

  async ping(): Promise<boolean> {
    if (!(this.client && this.connected)) return false;
    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  // --- ThreadState CRUD ---

  async saveThreadState(threadId: string, state: ThreadState): Promise<void> {
    const normalized = { ...state };
    if (
      normalized.planOutput &&
      Buffer.byteLength(normalized.planOutput, "utf-8") > PLAN_OUTPUT_MAX_BYTES
    ) {
      getLogger().warn(
        {
          threadId,
          originalBytes: Buffer.byteLength(normalized.planOutput, "utf-8"),
          maxBytes: PLAN_OUTPUT_MAX_BYTES,
        },
        "planOutput exceeds 10KB, truncating",
      );
      let truncated = normalized.planOutput;
      while (Buffer.byteLength(truncated, "utf-8") > PLAN_OUTPUT_MAX_BYTES) {
        truncated = truncated.slice(0, -1);
      }
      normalized.planOutput = truncated;
    }

    if (this.client && this.connected) {
      try {
        const key = RedisClient.threadKey(threadId);
        await this.client.hSet(key, {
          initiatedBy: normalized.initiatedBy,
          issueNumber: String(normalized.issueNumber),
          repo: normalized.repo,
          branch: normalized.branch,
          workspacePath: normalized.workspacePath,
          currentPhase: normalized.currentPhase,
          subStage: normalized.subStage,
          lastError: normalized.lastError ?? "",
          planOutput: normalized.planOutput ?? "",
        });
        return;
      } catch {
        getLogger().debug(
          { threadId },
          "saveThreadState failed, using fallback",
        );
      }
    }
    this.ensureFallbackCapacity();
    this.fallbackHash.set(RedisClient.threadKey(threadId), {
      state: normalized,
      expiresAt: Date.now() + THREAD_SESSION_TTL_S * 1000,
    });
    this.logFallbackSize();
  }

  async getThreadState(threadId: string): Promise<ThreadState | null> {
    if (this.client && this.connected) {
      try {
        const raw = await this.client.hGetAll(RedisClient.threadKey(threadId));
        if (!raw || Object.keys(raw).length === 0) return null;
        return RedisClient.parseThreadState(raw);
      } catch {
        getLogger().debug(
          { threadId },
          "getThreadState failed, using fallback",
        );
      }
    }
    const entry = this.fallbackHash.get(RedisClient.threadKey(threadId));
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.fallbackHash.delete(RedisClient.threadKey(threadId));
      return null;
    }
    return entry.state;
  }

  async deleteThreadState(threadId: string): Promise<void> {
    const key = RedisClient.threadKey(threadId);
    const phases = ["plan", "develop", "test", "commit"];
    if (this.client && this.connected) {
      try {
        const cl = this.client;
        await Promise.all([
          cl.del(key),
          ...phases.map((p) => cl.del(RedisClient.codexKey(threadId, p))),
        ]);
      } catch {
        getLogger().debug(
          { threadId },
          "deleteThreadState failed, using fallback",
        );
      }
    }
    this.fallbackHash.delete(key);
    for (const phase of phases) {
      this.fallback.delete(RedisClient.codexKey(threadId, phase));
    }
  }

  // --- CAS ---

  async compareAndSwapPhase(
    threadId: string,
    expected: Phase,
    target: Phase,
  ): Promise<boolean> {
    const key = RedisClient.threadKey(threadId);

    if (this.client && this.connected) {
      try {
        const result = await this.client.eval(RedisClient.CAS_SCRIPT, {
          keys: [key],
          arguments: [expected, target],
        });
        return result === 1;
      } catch {
        getLogger().debug(
          { threadId, expected, target },
          "compareAndSwapPhase failed, using fallback",
        );
      }
    }

    const entry = this.fallbackHash.get(key);
    if (!entry) return false;
    if (entry.state.currentPhase !== expected) return false;
    entry.state.currentPhase = target;
    entry.state.subStage = "idle";
    return true;
  }

  // --- codex thread ID ---

  async saveCodexThread(
    threadId: string,
    phase: string,
    codexThreadId: string,
  ): Promise<void> {
    const key = RedisClient.codexKey(threadId, phase);
    if (this.client && this.connected) {
      try {
        await this.client.set(key, codexThreadId);
        return;
      } catch {
        getLogger().debug(
          { threadId, phase },
          "saveCodexThread failed, using fallback",
        );
      }
    }
    this.ensureFallbackCapacity();
    this.fallback.set(key, {
      value: codexThreadId,
      expiresAt: Date.now() + THREAD_SESSION_TTL_S * 1000,
    });
    this.logFallbackSize();
  }

  async getCodexThread(
    threadId: string,
    phase: string,
  ): Promise<string | null> {
    const key = RedisClient.codexKey(threadId, phase);
    if (this.client && this.connected) {
      try {
        return await this.client.get(key);
      } catch {
        getLogger().debug(
          { threadId, phase },
          "getCodexThread failed, using fallback",
        );
        return this.fallbackGet(key);
      }
    }
    return this.fallbackGet(key);
  }

  // --- TTL ---

  async setThreadTTL(threadId: string, seconds: number): Promise<void> {
    const key = RedisClient.threadKey(threadId);
    if (this.client && this.connected) {
      try {
        const phases = ["plan", "develop", "test", "commit"];
        const cl = this.client;
        await Promise.all([
          cl.expire(key, seconds),
          ...phases.map((p) =>
            cl.expire(RedisClient.codexKey(threadId, p), seconds),
          ),
        ]);
        return;
      } catch {
        getLogger().debug({ threadId }, "setThreadTTL failed, using fallback");
      }
    }
    const entry = this.fallbackHash.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + seconds * 1000;
    }
  }

  // --- helpers ---

  private static threadKey(threadId: string): string {
    return `codex:develop:${threadId}`;
  }

  private static codexKey(threadId: string, phase: string): string {
    return `codex:develop:${threadId}/${phase}`;
  }

  private static parseThreadState(raw: Record<string, string>): ThreadState {
    return {
      initiatedBy: raw.initiatedBy,
      issueNumber: Number(raw.issueNumber),
      repo: raw.repo,
      branch: raw.branch,
      workspacePath: raw.workspacePath,
      currentPhase: raw.currentPhase as Phase,
      subStage: raw.subStage as ThreadState["subStage"],
      lastError: raw.lastError || null,
      planOutput: raw.planOutput || null,
    };
  }

  // --- fallback cleanup ---

  private ensureFallbackCapacity(): void {
    const maxSize = RedisClient.FALLBACK_MAX_SIZE;
    const now = Date.now();
    for (const [key, entry] of this.fallback) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.fallback.delete(key);
      }
    }
    for (const [key, entry] of this.fallbackHash) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.fallbackHash.delete(key);
      }
    }
    let toEvict = this.fallback.size + this.fallbackHash.size - maxSize;
    while (toEvict > 0 && this.fallback.size > 0) {
      const oldest = this.fallback.keys().next().value as string;
      this.fallback.delete(oldest);
      toEvict--;
    }
    while (toEvict > 0 && this.fallbackHash.size > 0) {
      const oldest = this.fallbackHash.keys().next().value as string;
      this.fallbackHash.delete(oldest);
      toEvict--;
    }
  }

  private startFallbackCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.purgeExpired(), 5 * 60 * 1000);
    if (
      this.cleanupTimer &&
      typeof this.cleanupTimer === "object" &&
      "unref" in this.cleanupTimer
    ) {
      (
        this.cleanupTimer as ReturnType<typeof setInterval> & { unref(): void }
      ).unref();
    }
  }

  private stopFallbackCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.fallback) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.fallback.delete(key);
      }
    }
    for (const [key, entry] of this.fallbackHash) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.fallbackHash.delete(key);
      }
    }
    this.logFallbackSize();
  }

  private logFallbackSize(): void {
    const total = this.fallback.size + this.fallbackHash.size;
    if (total === 0) return;
    const logger = getLogger();
    logger.debug({ fallbackSize: total }, "Fallback memory usage");
    if (total > 100) {
      logger.warn(
        {
          fallbackSize: total,
          fallbackMap: this.fallback.size,
          fallbackHashMap: this.fallbackHash.size,
        },
        "Fallback memory usage exceeds threshold",
      );
    }
  }

  private fallbackGet(key: string): string | null {
    const entry = this.fallback.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.fallback.delete(key);
      return null;
    }
    return entry.value;
  }
}
