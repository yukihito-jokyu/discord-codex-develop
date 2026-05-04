import type { CodexExecClient } from "@/ai/client/codex-exec.client";
import { buildDevelopCommitPrompt } from "@/ai/prompts/templates/develop-commit";
import type { GitHubClient } from "@/infrastructure/github/github.client";
import type { RedisClient } from "@/infrastructure/redis/redis.client";
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

interface CommitCommandDeps {
  redis: RedisClient;
  codexExec: CodexExecClient;
  workspace: WorkspaceManager;
  github: GitHubClient;
  discordClient: DiscordClient;
  githubOwner: string;
  githubRepo: string;
}

export class CommitCommand implements Command {
  readonly name = "commit";
  readonly definition = {
    description: "変更をコミット",
  };

  constructor(private readonly deps: CommitCommandDeps) {}

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
      log.error({ err: String(err) }, "CommitCommand background error");
    });

    return Promise.resolve(deferred());
  }

  private async buildCommitPrompt(
    state: import("@/infrastructure/redis/thread-state.types").ThreadState,
    channelId: string,
    interactionToken: string,
  ): Promise<string | null> {
    const { workspace, github, discordClient, githubOwner, githubRepo } =
      this.deps;

    const diffResult = await workspace.getDiff(state.workspacePath);
    if (!diffResult.ok) {
      const { redis } = this.deps;
      state.subStage = "idle";
      await redis.saveThreadState(channelId, state);
      await discordClient.editInteractionResponse(
        interactionToken,
        `diffの取得に失敗しました: ${diffResult.error.message}`,
      );
      return null;
    }

    const issueResult = await github.getIssue(
      githubOwner,
      githubRepo,
      state.issueNumber,
    );
    const issueTitle = issueResult.ok
      ? issueResult.value.title
      : `Issue #${state.issueNumber}`;

    return buildDevelopCommitPrompt({
      diff: diffResult.value,
      issueNumber: state.issueNumber,
      issueTitle,
    });
  }

  private async executeCommit(
    state: import("@/infrastructure/redis/thread-state.types").ThreadState,
    channelId: string,
    interactionToken: string,
  ): Promise<void> {
    const log = getLogger();
    const { redis, codexExec, discordClient } = this.deps;

    const prompt = await this.buildCommitPrompt(
      state,
      channelId,
      interactionToken,
    );
    if (!prompt) return;

    const codexResult = await executeCodexOrResume({
      codexExec,
      redis,
      channelId,
      phase: "commit",
      prompt,
      cwd: state.workspacePath,
      sandboxMode: "write",
    });

    state.subStage = "idle";
    const casSuccess = await redis.compareAndSwapPhase(
      channelId,
      "tested",
      "committed",
    );
    if (!casSuccess) state.currentPhase = "committed";
    await redis.saveThreadState(channelId, state);
    await discordClient.editInteractionResponse(
      interactionToken,
      formatForDiscord(codexResult.response),
    );
    log.info(
      { channelId, issueNumber: state.issueNumber },
      "CommitCommand completed",
    );
  }

  private async processInBackground(
    interaction: DomainInteraction,
    interactionToken: string,
  ): Promise<void> {
    const { redis, discordClient } = this.deps;
    const channelId = interaction.channelId;

    const vr = await validateThreadCommand({
      discordClient,
      redis,
      channelId,
      userId: interaction.userId,
      expectedPhases: ["tested"],
      interactionToken,
    });
    if (!vr) return;

    const state = vr.state;
    state.subStage = "running";
    await redis.saveThreadState(channelId, state);

    try {
      await this.executeCommit(state, channelId, interactionToken);
    } catch (err) {
      const log = getLogger();
      log.error({ err: String(err) }, "CommitCommand error");
      state.subStage = "idle";
      state.lastError = err instanceof Error ? err.message : String(err);
      await redis.saveThreadState(channelId, state);
      await discordClient.editInteractionResponse(
        interactionToken,
        // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
        "コミット中にエラーが発生しました。しばらくしてから再試行してください。",
      );
    }
  }
}
