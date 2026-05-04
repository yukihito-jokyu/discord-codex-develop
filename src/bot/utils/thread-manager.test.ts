import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogInfo = vi.fn();
const mockLogError = vi.fn();

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: mockLogInfo,
    error: mockLogError,
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockSendChannelMessage = vi.fn();
const mockCreateThreadFromMessage = vi.fn();
const mockArchiveThread = vi.fn();

const mockDiscordClient = {
  sendChannelMessage: mockSendChannelMessage,
  createThreadFromMessage: mockCreateThreadFromMessage,
  archiveThread: mockArchiveThread,
} as never;

const { ThreadManager } = await import("./thread-manager");

function createManager() {
  return new ThreadManager(mockDiscordClient);
}

describe("ThreadManager.createDevThread returns thread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns threadId on success", async () => {
    mockSendChannelMessage.mockResolvedValue("msg-123");
    mockCreateThreadFromMessage.mockResolvedValue("thread-456");
    const manager = createManager();

    const result = await manager.createDevThread("ch-1", 42, "Fix bug");

    expect(result).toBe("thread-456");
  });

  it("sends correct message content with issue number", async () => {
    mockSendChannelMessage.mockResolvedValue("msg-123");
    mockCreateThreadFromMessage.mockResolvedValue("thread-456");
    const manager = createManager();

    await manager.createDevThread("ch-1", 42, "Fix bug");

    expect(mockSendChannelMessage).toHaveBeenCalledWith(
      "ch-1",
      "Issue #42 開発スレッド",
    );
  });
});

describe("ThreadManager.createDevThread thread name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats thread name as #number title", async () => {
    mockSendChannelMessage.mockResolvedValue("msg-123");
    mockCreateThreadFromMessage.mockResolvedValue("thread-456");
    const manager = createManager();

    await manager.createDevThread("ch-1", 42, "Fix bug");

    expect(mockCreateThreadFromMessage).toHaveBeenCalledWith(
      "ch-1",
      "msg-123",
      "#42 Fix bug",
    );
  });

  it("truncates long thread name to 100 characters", async () => {
    mockSendChannelMessage.mockResolvedValue("msg-123");
    mockCreateThreadFromMessage.mockResolvedValue("thread-456");
    const manager = createManager();

    const longTitle = "a".repeat(150);
    await manager.createDevThread("ch-1", 42, longTitle);

    const threadName = mockCreateThreadFromMessage.mock.calls[0][2] as string;
    expect(threadName.length).toBeLessThanOrEqual(100);
    expect(threadName).toBe(`#42 ${longTitle}`.slice(0, 100));
  });

  it("does not truncate thread name when exactly 100 characters", async () => {
    mockSendChannelMessage.mockResolvedValue("msg-123");
    mockCreateThreadFromMessage.mockResolvedValue("thread-456");
    const manager = createManager();

    const title = "a".repeat(96);
    await manager.createDevThread("ch-1", 42, title);

    const threadName = mockCreateThreadFromMessage.mock.calls[0][2] as string;
    expect(threadName).toBe(`#42 ${title}`);
    expect(threadName).toHaveLength(100);
  });
});

describe("ThreadManager.createDevThread failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when message send fails", async () => {
    mockSendChannelMessage.mockResolvedValue(null);
    const manager = createManager();

    const result = await manager.createDevThread("ch-1", 42, "Fix bug");

    expect(result).toBeNull();
    expect(mockLogError).toHaveBeenCalledWith(
      { channelId: "ch-1", issueNumber: 42 },
      "Failed to send initial message for dev thread",
    );
  });

  it("returns null when thread creation fails", async () => {
    mockSendChannelMessage.mockResolvedValue("msg-123");
    mockCreateThreadFromMessage.mockResolvedValue(null);
    const manager = createManager();

    const result = await manager.createDevThread("ch-1", 42, "Fix bug");

    expect(result).toBeNull();
    expect(mockLogError).toHaveBeenCalledWith(
      { channelId: "ch-1", issueNumber: 42, messageId: "msg-123" },
      "Failed to create dev thread",
    );
  });
});

describe("ThreadManager.archiveThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes without error on success", async () => {
    mockArchiveThread.mockResolvedValue(true);
    const manager = createManager();

    await expect(manager.archiveThread("thread-456")).resolves.toBeUndefined();
  });

  it("logs error on failure", async () => {
    mockArchiveThread.mockResolvedValue(false);
    const manager = createManager();

    await manager.archiveThread("thread-456");

    expect(mockLogError).toHaveBeenCalledWith(
      { threadId: "thread-456" },
      "Failed to archive thread",
    );
  });
});
