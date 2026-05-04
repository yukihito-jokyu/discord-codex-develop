import type { CodexExecClient } from "@/ai/client/codex-exec.client";
import { buildDevelopCommitPrompt } from "@/ai/prompts/templates/develop-commit";
import { buildDevelopImplPrompt } from "@/ai/prompts/templates/develop-impl";
import { buildDevelopPlanPrompt } from "@/ai/prompts/templates/develop-plan";
import { buildDevelopTestPrompt } from "@/ai/prompts/templates/develop-test";
import type { GitHubClient } from "@/infrastructure/github/github.client";
import type { RedisClient } from "@/infrastructure/redis/redis.client";
import type {
  Phase,
  ThreadState,
} from "@/infrastructure/redis/thread-state.types";
import type { WorkspaceManager } from "@/infrastructure/workspace/workspace.manager";
import { ValidationError } from "@/shared/types/errors";
import { err, ok, type Result } from "@/shared/types/result";
import { getLogger } from "@/shared/utils/logger";

export interface DevelopServiceDeps {
  redis: RedisClient;
  codexExec: CodexExecClient;
  github: GitHubClient;
  workspace: WorkspaceManager;
  githubOwner: string;
  githubRepo: string;
}

export class DevelopService {
  constructor(private readonly deps: DevelopServiceDeps) {}

  getState(channelId: string): Promise<ThreadState | null> {
    return this.deps.redis.getThreadState(channelId);
  }

  async saveState(channelId: string, state: ThreadState): Promise<void> {
    await this.deps.redis.saveThreadState(channelId, state);
  }

  async setRunning(channelId: string, state: ThreadState): Promise<void> {
    state.subStage = "running";
    await this.deps.redis.saveThreadState(channelId, state);
  }

  async setError(
    channelId: string,
    state: ThreadState,
    error: string,
  ): Promise<void> {
    state.subStage = "idle";
    state.lastError = error;
    await this.deps.redis.saveThreadState(channelId, state);
  }

  async transitionPhase(
    channelId: string,
    from: Phase,
    to: Phase,
  ): Promise<boolean> {
    const success = await this.deps.redis.compareAndSwapPhase(
      channelId,
      from,
      to,
    );
    if (!success) {
      const log = getLogger();
      log.warn(
        { channelId, expected: from, target: to },
        "CAS failed, force-updating phase",
      );
    }
    return success;
  }

  async validateThreadCommand(options: {
    channelId: string;
    userId: string;
    expectedPhases: Phase[];
  }): Promise<Result<{ state: ThreadState }>> {
    const { channelId, userId, expectedPhases } = options;

    const state = await this.deps.redis.getThreadState(channelId);
    if (!state) {
      return err(
        new ValidationError(
          // biome-ignore lint/security/noSecrets: Japanese UI text, not a secret
          "ワークフローが初期化されていません。先に `/init` を実行してください。",
        ),
      );
    }

    if (state.initiatedBy !== userId) {
      return err(
        // biome-ignore lint/security/noSecrets: Japanese UI text, not a secret
        new ValidationError("このワークフローの実行者のみが操作できます。"),
      );
    }

    if (!expectedPhases.includes(state.currentPhase)) {
      return err(
        new ValidationError(
          `現在のフェーズが不正です (現在: ${state.currentPhase}, 期待: ${expectedPhases.join(" または ")})`,
        ),
      );
    }

    if (state.subStage === "running") {
      return err(
        new ValidationError(
          // biome-ignore lint/security/noSecrets: Japanese UI text, not a secret
          "現在別の処理が実行中です。完了してから再試行してください。",
        ),
      );
    }

    return ok({ state });
  }

  async validateInit(options: {
    channelId: string;
    userId: string;
    issueNumber: number;
  }): Promise<Result<null>> {
    const { channelId, userId, issueNumber } = options;

    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      return err(
        // biome-ignore lint/security/noSecrets: Japanese UI text, not a secret
        new ValidationError("Issue番号は正の整数で指定してください。"),
      );
    }

    const existingState = await this.deps.redis.getThreadState(channelId);
    if (existingState && existingState.subStage === "running") {
      return err(
        new ValidationError(
          // biome-ignore lint/security/noSecrets: Japanese UI text, not a secret
          "現在別の処理が実行中です。完了してから再試行してください。",
        ),
      );
    }

    if (existingState && existingState.initiatedBy !== userId) {
      return err(
        // biome-ignore lint/security/noSecrets: Japanese UI text, not a secret
        new ValidationError("このワークフローは別のユーザーが初期化しました。"),
      );
    }

    return ok(null);
  }

  fetchIssue(issueNumber: number) {
    return this.deps.github.getIssue(
      this.deps.githubOwner,
      this.deps.githubRepo,
      issueNumber,
    );
  }

  async setupWorkspace(
    issueNumber: number,
  ): Promise<Result<{ branchName: string; targetDir: string }>> {
    const { githubOwner, githubRepo, workspace } = this.deps;
    const branchName = `feature/${issueNumber}`;
    const targetDir = `${githubRepo}-${issueNumber}`;
    const repoUrl = `https://github.com/${githubOwner}/${githubRepo}.git`;

    const cloneResult = await workspace.ensureClone(repoUrl, targetDir);
    if (!cloneResult.ok) {
      return err(cloneResult.error);
    }

    const syncResult = await workspace.syncMain(targetDir);
    if (!syncResult.ok) {
      return err(syncResult.error);
    }

    const branchResult = await workspace.createBranch(targetDir, branchName);
    if (!branchResult.ok) {
      return err(branchResult.error);
    }

    return ok({ branchName, targetDir });
  }

  async initializeState(options: {
    channelId: string;
    userId: string;
    issueNumber: number;
    branchName: string;
    targetDir: string;
  }): Promise<void> {
    const { channelId, userId, issueNumber, branchName, targetDir } = options;
    const { githubOwner, githubRepo } = this.deps;

    const initialState: ThreadState = {
      initiatedBy: userId,
      issueNumber,
      repo: `${githubOwner}/${githubRepo}`,
      branch: branchName,
      workspacePath: targetDir,
      currentPhase: "init",
      subStage: "idle",
      lastError: null,
      planOutput: null,
    };

    await this.deps.redis.saveThreadState(channelId, initialState);
  }

  async executePlan(
    channelId: string,
    state: ThreadState,
  ): Promise<Result<{ response: string }>> {
    const log = getLogger();
    const { github, githubOwner, githubRepo } = this.deps;

    const issueResult = await github.getIssue(
      githubOwner,
      githubRepo,
      state.issueNumber,
    );
    if (!issueResult.ok) {
      return err(issueResult.error);
    }

    const prompt = buildDevelopPlanPrompt({
      issueBody: issueResult.value.body ?? "",
      repo: state.repo,
      branch: state.branch,
    });
    const codexResult = await this.executeCodexOrResume({
      channelId,
      phase: "plan",
      prompt,
      cwd: state.workspacePath,
      sandboxMode: "read-only",
    });

    state.planOutput = codexResult.response;
    state.subStage = "idle";
    await this.transitionPhase(channelId, state.currentPhase, "planned");
    state.currentPhase = "planned";
    await this.deps.redis.saveThreadState(channelId, state);

    log.info(
      { channelId, issueNumber: state.issueNumber },
      "Plan phase completed",
    );
    return ok({ response: codexResult.response });
  }

  async executeDevelop(
    channelId: string,
    state: ThreadState,
  ): Promise<Result<{ response: string; diff: string }>> {
    const log = getLogger();
    const { workspace } = this.deps;

    const prompt = buildDevelopImplPrompt({
      planOutput: state.planOutput ?? "",
      repo: state.repo,
      branch: state.branch,
    });
    const codexResult = await this.executeCodexOrResume({
      channelId,
      phase: "develop",
      prompt,
      cwd: state.workspacePath,
      sandboxMode: "write",
    });

    const diffResult = await workspace.getDiff(state.workspacePath);
    const diffText = diffResult.ok ? diffResult.value : "";

    state.subStage = "idle";
    await this.transitionPhase(channelId, "planned", "developed");
    state.currentPhase = "developed";
    await this.deps.redis.saveThreadState(channelId, state);

    log.info(
      { channelId, issueNumber: state.issueNumber },
      "Develop phase completed",
    );
    return ok({ response: codexResult.response, diff: diffText });
  }

  async executeTest(
    channelId: string,
    state: ThreadState,
  ): Promise<Result<{ response: string; diff: string }>> {
    const log = getLogger();
    const { workspace } = this.deps;

    const diffResult = await workspace.getDiff(state.workspacePath);
    if (!diffResult.ok) {
      return err(diffResult.error);
    }

    const prompt = buildDevelopTestPrompt({
      diff: diffResult.value,
      repo: state.repo,
      branch: state.branch,
    });
    const codexResult = await this.executeCodexOrResume({
      channelId,
      phase: "test",
      prompt,
      cwd: state.workspacePath,
      sandboxMode: "write",
    });

    const postDiffResult = await workspace.getDiff(state.workspacePath);
    const postDiffText = postDiffResult.ok ? postDiffResult.value : "";

    state.subStage = "idle";
    await this.transitionPhase(channelId, "developed", "tested");
    state.currentPhase = "tested";
    await this.deps.redis.saveThreadState(channelId, state);

    log.info(
      { channelId, issueNumber: state.issueNumber },
      "Test phase completed",
    );
    return ok({ response: codexResult.response, diff: postDiffText });
  }

  async executeCommit(
    channelId: string,
    state: ThreadState,
  ): Promise<Result<{ response: string }>> {
    const log = getLogger();
    const { workspace, github, githubOwner, githubRepo } = this.deps;

    const diffResult = await workspace.getDiff(state.workspacePath);
    if (!diffResult.ok) {
      return err(diffResult.error);
    }

    const issueResult = await github.getIssue(
      githubOwner,
      githubRepo,
      state.issueNumber,
    );
    const issueTitle = issueResult.ok
      ? issueResult.value.title
      : `Issue #${state.issueNumber}`;

    const prompt = buildDevelopCommitPrompt({
      diff: diffResult.value,
      issueNumber: state.issueNumber,
      issueTitle,
    });
    const codexResult = await this.executeCodexOrResume({
      channelId,
      phase: "commit",
      prompt,
      cwd: state.workspacePath,
      sandboxMode: "write",
    });

    state.subStage = "idle";
    await this.transitionPhase(channelId, "tested", "committed");
    state.currentPhase = "committed";
    await this.deps.redis.saveThreadState(channelId, state);

    log.info(
      { channelId, issueNumber: state.issueNumber },
      "Commit phase completed",
    );
    return ok({ response: codexResult.response });
  }

  async executePr(
    channelId: string,
    state: ThreadState,
  ): Promise<Result<{ prUrl: string }>> {
    const log = getLogger();
    const { github, githubOwner, githubRepo } = this.deps;

    const pushPrompt = [
      // biome-ignore lint/security/noSecrets: Japanese UI text, not a secret
      "現在のブランチをリモートにプッシュしてください。",
      // biome-ignore lint/security/noSecrets: Japanese UI text, not a secret
      "以下のコマンドを実行してください:",
      "git push -u origin HEAD",
    ].join("\n");
    await this.executeCodexOrResume({
      channelId,
      phase: "pr",
      prompt: pushPrompt,
      cwd: state.workspacePath,
      sandboxMode: "write",
    });

    const issueResult = await github.getIssue(
      githubOwner,
      githubRepo,
      state.issueNumber,
    );
    const issueTitle = issueResult.ok
      ? issueResult.value.title
      : `Issue #${state.issueNumber}`;
    const issueBody = issueResult.ok ? (issueResult.value.body ?? "") : "";

    const prResult = await github.createPullRequest(githubOwner, githubRepo, {
      title: issueTitle,
      body: `Closes #${state.issueNumber}\n\n${issueBody}`,
      head: state.branch,
      base: "main",
    });
    if (!prResult.ok) {
      return err(prResult.error);
    }

    state.subStage = "idle";
    await this.transitionPhase(channelId, "committed", "completed");
    state.currentPhase = "completed";
    await this.deps.redis.saveThreadState(channelId, state);

    log.info(
      { channelId, issueNumber: state.issueNumber, prUrl: prResult.value.url },
      "PR phase completed",
    );
    return ok({ prUrl: prResult.value.url });
  }

  discardChanges(state: ThreadState): Promise<Result<void>> {
    return this.deps.workspace.discardChanges(state.workspacePath);
  }

  private async executeCodexOrResume(options: {
    channelId: string;
    phase: string;
    prompt: string;
    cwd: string;
    sandboxMode: "read-only" | "write";
  }) {
    const { channelId, phase, prompt, cwd, sandboxMode } = options;
    const existingThreadId = await this.deps.redis.getCodexThread(
      channelId,
      phase,
    );
    const execOptions = { prompt, cwd, sandboxMode };

    const result = existingThreadId
      ? await this.deps.codexExec.resumeThread(
          existingThreadId,
          prompt,
          execOptions,
        )
      : await this.deps.codexExec.startThread(prompt, execOptions);

    await this.deps.redis.saveCodexThread(channelId, phase, result.threadId);
    return result;
  }
}
