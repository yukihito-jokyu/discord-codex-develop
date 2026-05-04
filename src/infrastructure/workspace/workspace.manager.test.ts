import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalServiceError } from "@/shared/types/errors";
import { WorkspaceManager } from "./workspace.manager";

const { mockExecCommand, mockExistsSync } = vi.hoisted(() => ({
  mockExecCommand: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock("@/shared/utils/exec", () => ({
  execCommand: mockExecCommand,
}));

vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
}));

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const WORKSPACE_ROOT = "/workspace";

describe("WorkspaceManager ensureClone", () => {
  let manager: WorkspaceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorkspaceManager(WORKSPACE_ROOT);
  });

  it("clones repository when directory does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecCommand.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await manager.ensureClone(
      "https://github.com/owner/repo.git",
      "repos/repo",
    );

    expect(result.ok).toBe(true);
    expect(mockExecCommand).toHaveBeenCalledWith(
      "git",
      ["clone", "https://github.com/owner/repo.git", "/workspace/repos/repo"],
      { timeout: 60_000 },
    );
  });

  it("skips clone when directory already exists", async () => {
    mockExistsSync.mockReturnValue(true);

    const result = await manager.ensureClone(
      "https://github.com/owner/repo.git",
      "repos/repo",
    );

    expect(result.ok).toBe(true);
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  it("returns ExternalServiceError on clone failure", async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecCommand.mockRejectedValue(new Error("clone failed"));

    const result = await manager.ensureClone(
      "https://github.com/owner/repo.git",
      "repos/repo",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("clone failed");
    }
  });

  it("returns ExternalServiceError when non-Error is thrown during clone", async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecCommand.mockRejectedValue("timeout");

    const result = await manager.ensureClone(
      "https://github.com/owner/repo.git",
      "repos/repo",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("timeout");
    }
  });
});

describe("WorkspaceManager syncMain", () => {
  let manager: WorkspaceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorkspaceManager(WORKSPACE_ROOT);
  });

  it("checks out main and pulls latest", async () => {
    mockExecCommand.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await manager.syncMain("repos/repo");

    expect(result.ok).toBe(true);
    expect(mockExecCommand).toHaveBeenCalledTimes(2);
    expect(mockExecCommand).toHaveBeenCalledWith("git", ["checkout", "main"], {
      cwd: "/workspace/repos/repo",
      timeout: 60_000,
    });
    expect(mockExecCommand).toHaveBeenCalledWith("git", ["pull"], {
      cwd: "/workspace/repos/repo",
      timeout: 60_000,
    });
  });

  it("returns ExternalServiceError on checkout failure", async () => {
    mockExecCommand.mockRejectedValueOnce(new Error("checkout failed"));

    const result = await manager.syncMain("repos/repo");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("checkout failed");
    }
  });

  it("returns ExternalServiceError on pull failure", async () => {
    mockExecCommand
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockRejectedValueOnce(new Error("pull failed"));

    const result = await manager.syncMain("repos/repo");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("pull failed");
    }
  });

  it("returns ExternalServiceError when non-Error is thrown during sync", async () => {
    mockExecCommand.mockRejectedValue("connection lost");

    const result = await manager.syncMain("repos/repo");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("connection lost");
    }
  });
});

describe("WorkspaceManager createBranch", () => {
  let manager: WorkspaceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorkspaceManager(WORKSPACE_ROOT);
  });

  it("creates a new feature branch", async () => {
    mockExecCommand.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await manager.createBranch("repos/repo", "feature/123");

    expect(result.ok).toBe(true);
    expect(mockExecCommand).toHaveBeenCalledWith(
      "git",
      ["checkout", "-b", "feature/123"],
      { cwd: "/workspace/repos/repo", timeout: 60_000 },
    );
  });

  it("returns ExternalServiceError on failure", async () => {
    mockExecCommand.mockRejectedValue(new Error("branch creation failed"));

    const result = await manager.createBranch("repos/repo", "feature/123");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("branch creation failed");
    }
  });

  it("returns ExternalServiceError when non-Error is thrown", async () => {
    mockExecCommand.mockRejectedValue("signal abort");

    const result = await manager.createBranch("repos/repo", "feature/123");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("signal abort");
    }
  });
});

describe("WorkspaceManager getDiff", () => {
  let manager: WorkspaceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorkspaceManager(WORKSPACE_ROOT);
  });

  it("returns diff content", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "diff --git a/file.ts b/file.ts\n+new line",
      stderr: "",
    });

    const result = await manager.getDiff("repos/repo");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("diff --git");
    }
  });

  it("returns empty string when no diff", async () => {
    mockExecCommand.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await manager.getDiff("repos/repo");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("");
    }
  });

  it("returns ExternalServiceError on failure", async () => {
    mockExecCommand.mockRejectedValue(new Error("diff failed"));

    const result = await manager.getDiff("repos/repo");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("diff failed");
    }
  });

  it("returns ExternalServiceError when non-Error is thrown", async () => {
    mockExecCommand.mockRejectedValue("io error");

    const result = await manager.getDiff("repos/repo");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("io error");
    }
  });
});

describe("WorkspaceManager discardChanges", () => {
  let manager: WorkspaceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorkspaceManager(WORKSPACE_ROOT);
  });

  it("discards working directory changes", async () => {
    mockExecCommand.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await manager.discardChanges("repos/repo");

    expect(result.ok).toBe(true);
    expect(mockExecCommand).toHaveBeenCalledWith(
      "git",
      ["checkout", "--", "."],
      { cwd: "/workspace/repos/repo", timeout: 60_000 },
    );
  });

  it("returns ExternalServiceError on failure", async () => {
    mockExecCommand.mockRejectedValue(new Error("discard failed"));

    const result = await manager.discardChanges("repos/repo");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("discard failed");
    }
  });

  it("returns ExternalServiceError when non-Error is thrown", async () => {
    mockExecCommand.mockRejectedValue("unknown crash");

    const result = await manager.discardChanges("repos/repo");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("unknown crash");
    }
  });
});
