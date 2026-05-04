import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalServiceError, NotFoundError } from "@/shared/types/errors";
import { GitHubClient } from "./github.client";

const { mockExecCommand } = vi.hoisted(() => ({
  mockExecCommand: vi.fn(),
}));

vi.mock("@/shared/utils/exec", () => ({
  execCommand: mockExecCommand,
}));

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("GitHubClient getIssue mapping", () => {
  let client: GitHubClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new GitHubClient();
  });

  it("returns IssueInfo on successful gh api call", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: JSON.stringify({
        number: 42,
        title: "Bug fix",
        body: "Description here",
        state: "open",
        labels: [{ name: "bug" }, { name: "priority" }],
        assignees: [{ login: "dev1" }],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      }),
      stderr: "",
    });

    const result = await client.getIssue("owner", "repo", 42);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.number).toBe(42);
      expect(result.value.title).toBe("Bug fix");
      expect(result.value.state).toBe("open");
      expect(result.value.labels).toEqual(["bug", "priority"]);
      expect(result.value.assignees).toEqual(["dev1"]);
    }
  });

  it("maps null body correctly", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: JSON.stringify({
        number: 1,
        title: "No body",
        body: null,
        state: "open",
        labels: [],
        assignees: [],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      }),
      stderr: "",
    });

    const result = await client.getIssue("owner", "repo", 1);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.body).toBeNull();
    }
  });

  it("maps undefined body to null", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: JSON.stringify({
        number: 1,
        title: "No body",
        state: "open",
        labels: [],
        assignees: [],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      }),
      stderr: "",
    });

    const result = await client.getIssue("owner", "repo", 1);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.body).toBeNull();
    }
  });

  it("calls gh api with correct arguments", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: JSON.stringify({
        number: 42,
        title: "Test",
        body: null,
        state: "open",
        labels: [],
        assignees: [],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      }),
      stderr: "",
    });

    await client.getIssue("myOwner", "myRepo", 42);

    expect(mockExecCommand).toHaveBeenCalledWith(
      "gh",
      ["api", "repos/myOwner/myRepo/issues/42"],
      { timeout: 30_000 },
    );
  });

  it("maps closed state correctly", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: JSON.stringify({
        number: 5,
        title: "Closed issue",
        body: "Resolved",
        state: "closed",
        labels: [],
        assignees: [],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-03T00:00:00Z",
      }),
      stderr: "",
    });

    const result = await client.getIssue("owner", "repo", 5);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("closed");
    }
  });
});

describe("GitHubClient getIssue errors", () => {
  let client: GitHubClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new GitHubClient();
  });

  it("returns NotFoundError when issue does not exist", async () => {
    const error = new Error("Command failed");
    (error as unknown as { stderr: string }).stderr = '{"message":"Not Found"}';
    mockExecCommand.mockRejectedValue(error);

    const result = await client.getIssue("owner", "repo", 999);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(NotFoundError);
    }
  });

  it("returns ExternalServiceError on other failures", async () => {
    mockExecCommand.mockRejectedValue(new Error("authentication required"));

    const result = await client.getIssue("owner", "repo", 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("authentication required");
    }
  });

  it("returns ExternalServiceError when non-Error is thrown", async () => {
    mockExecCommand.mockRejectedValue("string error");

    const result = await client.getIssue("owner", "repo", 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("string error");
    }
  });

  it("returns NotFoundError when stderr is plain text containing 'Not Found'", async () => {
    const error = new Error("Command failed");
    (error as unknown as { stderr: string }).stderr =
      "error: Not Found in response";
    mockExecCommand.mockRejectedValue(error);

    const result = await client.getIssue("owner", "repo", 999);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(NotFoundError);
    }
  });

  it("returns ExternalServiceError when stderr JSON has different message", async () => {
    const error = new Error("Command failed");
    (error as unknown as { stderr: string }).stderr =
      '{"message":"Bad Request"}';
    mockExecCommand.mockRejectedValue(error);

    const result = await client.getIssue("owner", "repo", 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
    }
  });

  it("returns ExternalServiceError when error has no stderr property", async () => {
    mockExecCommand.mockRejectedValue(new Error("network error"));

    const result = await client.getIssue("owner", "repo", 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
    }
  });

  it("returns ExternalServiceError when stderr is empty string", async () => {
    const error = new Error("Command failed");
    (error as unknown as { stderr: string }).stderr = "";
    mockExecCommand.mockRejectedValue(error);

    const result = await client.getIssue("owner", "repo", 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
    }
  });
});

describe("GitHubClient createPullRequest success", () => {
  let client: GitHubClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new GitHubClient();
  });

  it("returns CreatePRResult on successful gh api call", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: JSON.stringify({
        html_url: "https://github.com/owner/repo/pull/10",
        number: 10,
      }),
      stderr: "",
    });

    const result = await client.createPullRequest("owner", "repo", {
      title: "Fix bug",
      body: "PR description",
      head: "fix-branch",
      base: "main",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.url).toBe("https://github.com/owner/repo/pull/10");
      expect(result.value.number).toBe(10);
    }
  });

  it("calls gh api with correct arguments", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: JSON.stringify({
        html_url: "https://github.com/owner/repo/pull/10",
        number: 10,
      }),
      stderr: "",
    });

    await client.createPullRequest("owner", "repo", {
      title: "Fix bug",
      body: "PR description",
      head: "fix-branch",
      base: "main",
    });

    expect(mockExecCommand).toHaveBeenCalledWith(
      "gh",
      [
        "api",
        "repos/owner/repo/pulls",
        "--method",
        "POST",
        "--field",
        "title=Fix bug",
        "--field",
        "body=PR description",
        "--field",
        "head=fix-branch",
        "--field",
        "base=main",
      ],
      { timeout: 30_000 },
    );
  });
});

describe("GitHubClient createPullRequest errors", () => {
  let client: GitHubClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new GitHubClient();
  });

  it("returns ExternalServiceError on failure", async () => {
    mockExecCommand.mockRejectedValue(new Error("validation failed"));

    const result = await client.createPullRequest("owner", "repo", {
      title: "Fix",
      body: "Desc",
      head: "branch",
      base: "main",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("validation failed");
    }
  });

  it("returns ExternalServiceError when non-Error is thrown", async () => {
    mockExecCommand.mockRejectedValue("network failure");

    const result = await client.createPullRequest("owner", "repo", {
      title: "Fix",
      body: "Desc",
      head: "branch",
      base: "main",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExternalServiceError);
      expect(result.error.message).toContain("network failure");
    }
  });
});
