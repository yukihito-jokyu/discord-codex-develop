import { Codex, type Usage, type ThreadOptions } from "@openai/codex-sdk";
import { ExternalServiceError } from "@/shared/types/errors";

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_MODEL = "codex-mini";

export interface CodexExecOptions {
  prompt: string;
  cwd: string;
  sandboxMode: "read-only" | "write" | "danger-full-access";
  timeoutMs?: number;
}

export interface CodexExecResult {
  response: string;
  threadId: string;
  usage: Usage | null;
}

export class CodexExecClient {
  private codex: Codex;
  private model: string;

  constructor(apiKey: string, options?: { baseUrl?: string; model?: string }) {
    this.codex = new Codex({ apiKey, baseUrl: options?.baseUrl });
    this.model = options?.model || DEFAULT_MODEL;
  }

  async startThread(
    prompt: string,
    options: CodexExecOptions,
  ): Promise<CodexExecResult> {
    const threadOptions = this.buildThreadOptions(options);
    const thread = this.codex.startThread(threadOptions);
    return await this.executeTurn(thread, prompt, options.timeoutMs);
  }

  async resumeThread(
    threadId: string,
    prompt: string,
    options: CodexExecOptions,
  ): Promise<CodexExecResult> {
    const threadOptions = this.buildThreadOptions(options);
    const thread = this.codex.resumeThread(threadId, threadOptions);
    return await this.executeTurn(thread, prompt, options.timeoutMs);
  }

  private mapSandboxMode(
    mode: "read-only" | "write" | "danger-full-access",
  ): "read-only" | "workspace-write" | "danger-full-access" {
    return mode === "write" ? "workspace-write" : mode;
  }

  private buildThreadOptions(options: CodexExecOptions): ThreadOptions {
    return {
      model: this.model,
      sandboxMode: this.mapSandboxMode(options.sandboxMode),
      workingDirectory: options.cwd,
      networkAccessEnabled: true,
      webSearchMode: "live",
      skipGitRepoCheck: true,
    };
  }

  private async executeTurn(
    thread: ReturnType<Codex["startThread"]>,
    input: Parameters<ReturnType<Codex["startThread"]>["run"]>[0],
    timeoutMs?: number,
  ): Promise<CodexExecResult> {
    const ms = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);

    try {
      const turn = await thread.run(input, { signal: controller.signal });
      const id = thread.id;
      if (!id) throw new Error("Thread ID is not available after run");
      return {
        response: turn.finalResponse,
        threadId: id,
        usage: turn.usage,
      };
    } catch (e) {
      if (
        (e instanceof Error && e.name === "AbortError") ||
        controller.signal.aborted
      ) {
        throw new ExternalServiceError(
          "CodexExec",
          `Request timed out after ${ms}ms`,
        );
      }
      if (e instanceof ExternalServiceError) throw e;
      throw new ExternalServiceError(
        "CodexExec",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
