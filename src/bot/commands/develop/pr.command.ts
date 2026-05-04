import type { CodexExecClient } from "@/ai/client/codex-exec.client";
import type { GitHubClient } from "@/infrastructure/github/github.client";
import type { RedisClient } from "@/infrastructure/redis/redis.client";
import type { ThreadState } from "@/infrastructure/redis/thread-state.types";
import type { WorkspaceManager } from "@/infrastructure/workspace/workspace.manager";
import { deferred, message } from "@/sdk/discord/adapter/response.adapter";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type {
  DomainInteraction,
  DomainResponse,
} from "@/sdk/discord/types/domain";
import { formatForDiscord } from "@/shared/utils/format";
import { getLogger } from "@/shared/utils/logger";
import type { Command } from "../command.interface";
import { executeCodexOrResume, validateThreadCommand } from "./validate";

interface PrCommandDeps {
  redis: RedisClient;
  codexExec: CodexExecClient;
  github: GitHubClient;
  workspace: WorkspaceManager;
  discordClient: DiscordClient;
  githubOwner: string;
  githubRepo: string;
}

export class PrCommand implements Command {
  readonly name = "pr";
  readonly definition = {
    // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
    description: "プルリクエストを作成",
  };

  constructor(private readonly deps: PrCommandDeps) {}

  execute(interaction: DomainInteraction): Promise<DomainResponse> {
    const log = getLogger();
    const token = (interaction.raw as { token?: string })?.token;
    if (!token) {
      log.error("Interaction has no token, cannot defer response");
      return Promise.resolve(
        message(
          // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
          "エラーが発生しました。しばらくしてからお試しください。",
          true,
        ),
      );
    }

    this.processInBackground(interaction, token).catch((err) => {
      log.error({ err: String(err) }, "PrCommand background error");
    });

    return Promise.resolve(deferred());
  }

  private async pushBranch(
    state: ThreadState,
    channelId: string,
  ): Promise<void> {
    const { redis, codexExec } = this.deps;
    const pushPrompt = [
      // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
      "現在のブランチをリモートにプッシュしてください。",
      // biome-ignore lint/security/noSecrets: static Japanese prompt text, not a secret
      "以下のコマンドを実行してください:",
      "git push -u origin HEAD",
    ].join("\n");

    await executeCodexOrResume({
      codexExec,
      redis,
      channelId,
      phase: "pr",
      prompt: pushPrompt,
      cwd: state.workspacePath,
      sandboxMode: "write",
    });
  }

  private async createPullRequest(
    state: ThreadState,
    channelId: string,
    interactionToken: string,
  ): Promise<void> {
    const { github, githubOwner, githubRepo } = this.deps;

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
      await this.handlePrFailure(
        state,
        channelId,
        interactionToken,
        prResult.error.message,
      );
      return;
    }

    await this.finalizePr(
      state,
      channelId,
      interactionToken,
      prResult.value.url,
    );
  }

  private async handlePrFailure(
    state: ThreadState,
    channelId: string,
    interactionToken: string,
    errorMessage: string,
  ): Promise<void> {
    const log = getLogger();
    const { redis, discordClient } = this.deps;
    log.error({ error: errorMessage }, "Failed to create PR");
    state.subStage = "idle";
    state.lastError = errorMessage;
    await redis.saveThreadState(channelId, state);
    await discordClient.editInteractionResponse(
      interactionToken,
      `PRの作成に失敗しました: ${errorMessage}`,
    );
  }

  private async finalizePr(
    state: ThreadState,
    channelId: string,
    interactionToken: string,
    prUrl: string,
  ): Promise<void> {
    const log = getLogger();
    const { redis, discordClient } = this.deps;
    state.subStage = "idle";
    const casSuccess = await redis.compareAndSwapPhase(
      channelId,
      "committed",
      "completed",
    );
    if (!casSuccess) state.currentPhase = "completed";

    await redis.saveThreadState(channelId, state);
    await discordClient.editInteractionResponse(
      interactionToken,
      formatForDiscord(`PRを作成しました: ${prUrl}`),
    );

    log.info(
      { channelId, issueNumber: state.issueNumber, prUrl },
      "PrCommand completed",
    );
  }

  private async executePr(
    state: ThreadState,
    channelId: string,
    interactionToken: string,
  ): Promise<void> {
    await this.pushBranch(state, channelId);
    await this.createPullRequest(state, channelId, interactionToken);
  }

  private async processInBackground(
    interaction: DomainInteraction,
    interactionToken: string,
  ): Promise<void> {
    const log = getLogger();
    const { redis, discordClient } = this.deps;
    const channelId = interaction.channelId;

    const vr = await validateThreadCommand({
      discordClient,
      redis,
      channelId,
      userId: interaction.userId,
      expectedPhases: ["committed"],
      interactionToken,
    });
    if (!vr) return;

    const state = vr.state;
    state.subStage = "running";
    await redis.saveThreadState(channelId, state);

    try {
      await this.executePr(state, channelId, interactionToken);
    } catch (err) {
      log.error({ err: String(err) }, "PrCommand error");
      state.subStage = "idle";
      state.lastError = err instanceof Error ? err.message : String(err);
      await redis.saveThreadState(channelId, state);
      await discordClient.editInteractionResponse(
        interactionToken,
        // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
        "PR作成中にエラーが発生しました。しばらくしてから再試行してください。",
      );
    }
  }
}
