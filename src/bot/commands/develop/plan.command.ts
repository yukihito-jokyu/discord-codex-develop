import type { CodexExecClient } from "@/ai/client/codex-exec.client";
import { buildDevelopPlanPrompt } from "@/ai/prompts/templates/develop-plan";
import type { GitHubClient } from "@/infrastructure/github/github.client";
import type { RedisClient } from "@/infrastructure/redis/redis.client";
import type { Phase } from "@/infrastructure/redis/thread-state.types";
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

interface PlanCommandDeps {
  redis: RedisClient;
  codexExec: CodexExecClient;
  github: GitHubClient;
  discordClient: DiscordClient;
  githubOwner: string;
  githubRepo: string;
}

const ALLOWED_PHASES: Phase[] = ["init", "planned"];

export class PlanCommand implements Command {
  readonly name = "plan";
  readonly definition = {
    // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
    description: "Issueに基づいて実装計画を作成",
  };

  constructor(private readonly deps: PlanCommandDeps) {}

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
      log.error({ err: String(err) }, "PlanCommand background error");
    });

    return Promise.resolve(deferred());
  }

  private async executePlan(
    state: import("@/infrastructure/redis/thread-state.types").ThreadState,
    channelId: string,
    interactionToken: string,
  ): Promise<void> {
    const log = getLogger();
    const { redis, codexExec, github, discordClient, githubOwner, githubRepo } =
      this.deps;

    const issueResult = await github.getIssue(
      githubOwner,
      githubRepo,
      state.issueNumber,
    );
    if (!issueResult.ok) {
      await this.handleError(
        channelId,
        state,
        interactionToken,
        `Issue #${state.issueNumber} の取得に失敗しました: ${issueResult.error.message}`,
      );
      return;
    }

    const prompt = buildDevelopPlanPrompt({
      issueBody: issueResult.value.body ?? "",
      repo: state.repo,
      branch: state.branch,
    });
    const codexResult = await executeCodexOrResume({
      codexExec,
      redis,
      channelId,
      phase: "plan",
      prompt,
      cwd: state.workspacePath,
      sandboxMode: "read-only",
    });

    state.planOutput = codexResult.response;
    state.subStage = "idle";
    const casSuccess = await redis.compareAndSwapPhase(
      channelId,
      state.currentPhase,
      "planned",
    );
    if (!casSuccess) state.currentPhase = "planned";
    await redis.saveThreadState(channelId, state);
    await discordClient.editInteractionResponse(
      interactionToken,
      formatForDiscord(codexResult.response),
    );
    log.info(
      { channelId, issueNumber: state.issueNumber },
      "PlanCommand completed",
    );
  }

  private async processInBackground(
    interaction: DomainInteraction,
    interactionToken: string,
  ): Promise<void> {
    const { redis, discordClient } = this.deps;
    const channelId = interaction.channelId;

    const result = await validateThreadCommand({
      discordClient,
      redis,
      channelId,
      userId: interaction.userId,
      expectedPhases: ALLOWED_PHASES,
      interactionToken,
    });
    if (!result) return;

    const state = result.state;
    state.subStage = "running";
    await redis.saveThreadState(channelId, state);

    try {
      await this.executePlan(state, channelId, interactionToken);
    } catch (err) {
      const log = getLogger();
      log.error({ err: String(err) }, "PlanCommand error");
      state.subStage = "idle";
      state.lastError = err instanceof Error ? err.message : String(err);
      await redis.saveThreadState(channelId, state);
      await discordClient.editInteractionResponse(
        interactionToken,
        // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
        "計画の作成中にエラーが発生しました。しばらくしてから再試行してください。",
      );
    }
  }

  private async handleError(
    channelId: string,
    state: import("@/infrastructure/redis/thread-state.types").ThreadState,
    interactionToken: string,
    errorMessage: string,
  ): Promise<void> {
    const { redis, discordClient } = this.deps;
    state.subStage = "idle";
    state.lastError = errorMessage;
    await redis.saveThreadState(channelId, state);
    await discordClient.editInteractionResponse(interactionToken, errorMessage);
  }
}
