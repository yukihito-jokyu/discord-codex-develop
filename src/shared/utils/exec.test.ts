import { beforeEach, describe, expect, it, vi } from "vitest";
import { execCommand } from "./exec";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

describe("execCommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns stdout and stderr on successful execution", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, { stdout: "hello world", stderr: "" });
    });

    const result = await execCommand("echo", ["hello", "world"]);

    expect(result).toEqual({ stdout: "hello world", stderr: "" });
  });

  it("passes cwd option to child process", async () => {
    mockExecFile.mockImplementation((_cmd, _args, opts, cb) => {
      expect(opts.cwd).toBe("/tmp/project");
      cb(null, { stdout: "", stderr: "" });
    });

    await execCommand("ls", [], { cwd: "/tmp/project" });
  });

  it("passes timeout option to child process", async () => {
    mockExecFile.mockImplementation((_cmd, _args, opts, cb) => {
      expect(opts.timeout).toBe(5000);
      cb(null, { stdout: "", stderr: "" });
    });

    await execCommand("ls", [], { timeout: 5000 });
  });

  it("throws on command failure", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(new Error("Command failed with exit code 1"));
    });

    await expect(execCommand("false", [])).rejects.toThrow(
      "Command failed with exit code 1",
    );
  });

  it("works without options (defaults)", async () => {
    mockExecFile.mockImplementation((_cmd, _args, opts, cb) => {
      expect(opts.cwd).toBeUndefined();
      expect(opts.timeout).toBeUndefined();
      cb(null, { stdout: "ok", stderr: "" });
    });

    const result = await execCommand("echo", ["test"]);

    expect(result.stdout).toBe("ok");
  });

  it("passes both cwd and timeout options together", async () => {
    mockExecFile.mockImplementation((_cmd, _args, opts, cb) => {
      expect(opts.cwd).toBe("/tmp/project");
      expect(opts.timeout).toBe(10_000);
      cb(null, { stdout: "done", stderr: "" });
    });

    const result = await execCommand("ls", [], {
      cwd: "/tmp/project",
      timeout: 10_000,
    });

    expect(result.stdout).toBe("done");
  });
});
