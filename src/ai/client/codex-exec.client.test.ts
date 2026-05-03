import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalServiceError } from "@/shared/types/errors";

const mockStartThread = vi.fn();
const mockResumeThread = vi.fn();
const mockRun = vi.fn();
const mockCodexConstructor = vi.fn();

vi.mock("@openai/codex-sdk", () => ({
  // biome-ignore lint/complexity/useArrowFunction: constructor mock requires function expression
  Codex: vi.fn().mockImplementation(function (options?: unknown) {
    mockCodexConstructor(options);
    return {
      startThread: mockStartThread,
      resumeThread: mockResumeThread,
    };
  }),
}));

const baseOptions = {
  prompt: "test-prompt",
  cwd: "/tmp/workspace",
  sandboxMode: "read-only" as const,
};

async function createClient(
  apiKey = "test-api-key",
  options?: { baseUrl?: string; model?: string },
) {
  const { CodexExecClient } = await import("./codex-exec.client");
  return new CodexExecClient(apiKey, options);
}

describe("CodexExecClient constructor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes apiKey and baseUrl to Codex SDK", async () => {
    await createClient("my-key", { baseUrl: "https://custom.api" });

    expect(mockCodexConstructor).toHaveBeenCalledWith({
      apiKey: "my-key",
      baseUrl: "https://custom.api",
    });
  });

  it("uses constructor model when provided", async () => {
    mockStartThread.mockReturnValue({ run: mockRun, id: "thread-1" });
    mockRun.mockResolvedValue({ finalResponse: "ok", usage: null });

    const client = await createClient("key", { model: "custom-model" });
    await client.startThread("hi", baseOptions);

    expect(mockStartThread).toHaveBeenCalledWith(
      expect.objectContaining({ model: "custom-model" }),
    );
  });

  it("falls back to codex-mini when no model is provided", async () => {
    mockStartThread.mockReturnValue({ run: mockRun, id: "thread-2" });
    mockRun.mockResolvedValue({ finalResponse: "ok", usage: null });

    const client = await createClient("key");
    await client.startThread("hi", baseOptions);

    expect(mockStartThread).toHaveBeenCalledWith(
      expect.objectContaining({ model: "codex-mini" }),
    );
  });

  it("handles no options parameter at all", async () => {
    mockStartThread.mockReturnValue({ run: mockRun, id: "thread-no-opts" });
    mockRun.mockResolvedValue({ finalResponse: "ok", usage: null });

    const client = await createClient("key");
    await client.startThread("hi", baseOptions);

    expect(mockCodexConstructor).toHaveBeenCalledWith({
      apiKey: "key",
      baseUrl: undefined,
    });
    expect(mockStartThread).toHaveBeenCalledWith(
      expect.objectContaining({ model: "codex-mini" }),
    );
  });
});

describe("CodexExecClient startThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartThread.mockReturnValue({ run: mockRun, id: "new-thread-123" });
    mockRun.mockResolvedValue({
      finalResponse: "Hello from exec",
      usage: {
        input_tokens: 10,
        cached_input_tokens: 0,
        output_tokens: 5,
        reasoning_output_tokens: 0,
      },
    });
  });

  it("starts new thread with correct options", async () => {
    const client = await createClient();
    const result = await client.startThread("Hello", baseOptions);

    expect(mockStartThread).toHaveBeenCalledWith({
      model: "codex-mini",
      sandboxMode: "read-only",
      workingDirectory: "/tmp/workspace",
      networkAccessEnabled: true,
      webSearchMode: "live",
      skipGitRepoCheck: true,
    });
    expect(result.response).toBe("Hello from exec");
    expect(result.threadId).toBe("new-thread-123");
  });

  it("returns usage from turn", async () => {
    const client = await createClient();
    const result = await client.startThread("Hello", baseOptions);

    expect(result.usage).toEqual({
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 5,
      reasoning_output_tokens: 0,
    });
  });

  it("handles null usage", async () => {
    mockRun.mockResolvedValue({ finalResponse: "No usage", usage: null });

    const client = await createClient();
    const result = await client.startThread("Hello", baseOptions);

    expect(result.usage).toBeNull();
  });
});

describe("CodexExecClient resumeThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResumeThread.mockReturnValue({
      run: mockRun,
      id: "existing-thread-456",
    });
    mockRun.mockResolvedValue({
      finalResponse: "Continued response",
      usage: {
        input_tokens: 20,
        cached_input_tokens: 5,
        output_tokens: 10,
        reasoning_output_tokens: 2,
      },
    });
  });

  it("resumes existing thread with correct threadId and options", async () => {
    const client = await createClient();
    const result = await client.resumeThread(
      "existing-thread-456",
      "Continue",
      baseOptions,
    );

    expect(mockResumeThread).toHaveBeenCalledWith("existing-thread-456", {
      model: "codex-mini",
      sandboxMode: "read-only",
      workingDirectory: "/tmp/workspace",
      networkAccessEnabled: true,
      webSearchMode: "live",
      skipGitRepoCheck: true,
    });
    expect(mockStartThread).not.toHaveBeenCalled();
    expect(result.response).toBe("Continued response");
    expect(result.threadId).toBe("existing-thread-456");
  });
});

describe("CodexExecClient timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartThread.mockReturnValue({ run: mockRun, id: "thread-timeout" });
    mockRun.mockImplementation(
      (_input: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
  });

  it("throws ExternalServiceError on timeout", async () => {
    const client = await createClient();

    await expect(
      client.startThread("test", {
        ...baseOptions,
        timeoutMs: 50,
      }),
    ).rejects.toThrow("Request timed out after 50ms");

    try {
      await client.startThread("test", { ...baseOptions, timeoutMs: 50 });
    } catch (e) {
      expect(e).toBeInstanceOf(ExternalServiceError);
    }
  });
});

describe("CodexExecClient API error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartThread.mockReturnValue({ run: mockRun, id: "thread-error" });
    mockRun.mockRejectedValue(new Error("SDK internal error"));
  });

  it("wraps SDK error in ExternalServiceError", async () => {
    const client = await createClient();

    await expect(client.startThread("test", baseOptions)).rejects.toThrow(
      "SDK internal error",
    );

    try {
      await client.startThread("test", baseOptions);
    } catch (e) {
      expect(e).toBeInstanceOf(ExternalServiceError);
      expect((e as ExternalServiceError).message).toBe(
        "CodexExec: SDK internal error",
      );
    }
  });
});

describe("CodexExecClient sandboxMode mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartThread.mockReturnValue({ run: mockRun, id: "thread-sandbox" });
    mockRun.mockResolvedValue({ finalResponse: "ok", usage: null });
  });

  it("passes read-only sandboxMode as-is", async () => {
    const client = await createClient();
    await client.startThread("test", {
      ...baseOptions,
      sandboxMode: "read-only",
    });

    expect(mockStartThread).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxMode: "read-only" }),
    );
  });

  it("maps write sandboxMode to workspace-write", async () => {
    const client = await createClient();
    await client.startThread("test", { ...baseOptions, sandboxMode: "write" });

    expect(mockStartThread).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxMode: "workspace-write" }),
    );
  });

  it("passes danger-full-access sandboxMode as-is", async () => {
    const client = await createClient();
    await client.startThread("test", {
      ...baseOptions,
      sandboxMode: "danger-full-access",
    });

    expect(mockStartThread).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxMode: "danger-full-access" }),
    );
  });
});

describe("CodexExecClient missing thread ID", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({ finalResponse: "Response", usage: null });
  });

  it("throws when thread ID is empty string after run", async () => {
    mockStartThread.mockReturnValue({ run: mockRun, id: "" });
    const client = await createClient();

    await expect(client.startThread("Hello", baseOptions)).rejects.toThrow(
      "Thread ID is not available after run",
    );
  });

  it("throws when thread ID is null after run", async () => {
    mockStartThread.mockReturnValue({ run: mockRun, id: null });
    const client = await createClient();

    await expect(client.startThread("Hello", baseOptions)).rejects.toThrow(
      "Thread ID is not available after run",
    );
  });

  it("throws when thread ID is undefined after run", async () => {
    mockStartThread.mockReturnValue({ run: mockRun, id: undefined });
    const client = await createClient();

    await expect(client.startThread("Hello", baseOptions)).rejects.toThrow(
      "Thread ID is not available after run",
    );
  });
});

describe("CodexExecClient non-Error thrown value", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartThread.mockReturnValue({ run: mockRun, id: "thread-non-error" });
  });

  it("wraps string thrown value in ExternalServiceError", async () => {
    mockRun.mockRejectedValue("something went wrong");

    const client = await createClient();

    try {
      await client.startThread("test", baseOptions);
    } catch (e) {
      expect(e).toBeInstanceOf(ExternalServiceError);
      expect((e as ExternalServiceError).message).toBe(
        "CodexExec: something went wrong",
      );
    }
  });
});

describe("CodexExecClient ExternalServiceError passthrough", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartThread.mockReturnValue({ run: mockRun, id: "thread-passthrough" });
  });

  it("re-throws ExternalServiceError without double-wrapping", async () => {
    const originalError = new ExternalServiceError("CodexExec", "original");
    mockRun.mockRejectedValue(originalError);

    const client = await createClient();

    try {
      await client.startThread("test", baseOptions);
    } catch (e) {
      expect(e).toBeInstanceOf(ExternalServiceError);
      expect(e).toBe(originalError);
      expect((e as ExternalServiceError).message).toBe("CodexExec: original");
    }
  });
});

describe("CodexExecClient default timeout", () => {
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    mockStartThread.mockReturnValue({
      run: mockRun,
      id: "thread-default-timeout",
    });
    mockRun.mockResolvedValue({ finalResponse: "ok", usage: null });
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
  });

  it("passes 600000ms to setTimeout when timeoutMs is not specified", async () => {
    const client = await createClient();
    await client.startThread("test", baseOptions);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 600_000);
  });

  it("passes custom timeoutMs to setTimeout when specified", async () => {
    const client = await createClient();
    await client.startThread("test", { ...baseOptions, timeoutMs: 5000 });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5_000);
  });
});
