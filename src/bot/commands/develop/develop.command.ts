import type { CodexExecClient } from "@/ai/client/codex-exec.client";
import { buildDevelopImplPrompt } from "@/ai/prompts/templates/develop-impl";
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

interface DevelopCommandDeps {
  redis: RedisClient;
  codexExec: CodexExecClient;
  workspace: WorkspaceManager;
  discordClient: DiscordClient;
}

export class DevelopCommand implements Command {
  readonly name = "develop";
  readonly definition = {
    // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
    description: "計画に基づいてコードを実装",
  };

  constructor(private readonly deps: DevelopCommandDeps) {}

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
      log.error({ err: String(err) }, "DevelopCommand background error");
    });

    return Promise.resolve(deferred());
  }

  private async executeDevelop(
    state: import("@/infrastructure/redis/thread-state.types").ThreadState,
    channelId: string,
    interactionToken: string,
  ): Promise<void> {
    const log = getLogger();
    const { redis, codexExec, workspace, discordClient } = this.deps;

    const prompt = buildDevelopImplPrompt({
      planOutput: state.planOutput ?? "",
      repo: state.repo,
      branch: state.branch,
    });
    const codexResult = await executeCodexOrResume({
      codexExec,
      redis,
      channelId,
      phase: "develop",
      prompt,
      cwd: state.workspacePath,
      sandboxMode: "write",
    });
    const diffResult = await workspace.getDiff(state.workspacePath);
    const diffText = diffResult.ok ? diffResult.value : "";

    state.subStage = "idle";
    const casSuccess = await redis.compareAndSwapPhase(
      channelId,
      "planned",
      "developed",
    );
    if (!casSuccess) state.currentPhase = "developed";
    await redis.saveThreadState(channelId, state);

    const responseText = diffText
      ? `**実装完了**\n\n\`\`\`diff\n${formatForDiscord(diffText)}\n\`\`\``
      : formatForDiscord(codexResult.response);
    await discordClient.editInteractionResponse(interactionToken, responseText);
    log.info(
      { channelId, issueNumber: state.issueNumber },
      "DevelopCommand completed",
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
      expectedPhases: ["planned"],
      interactionToken,
    });
    if (!vr) return;

    const state = vr.state;
    state.subStage = "running";
    await redis.saveThreadState(channelId, state);

    try {
      await this.executeDevelop(state, channelId, interactionToken);
    } catch (err) {
      const log = getLogger();
      log.error({ err: String(err) }, "DevelopCommand error");
      state.subStage = "idle";
      state.lastError = err instanceof Error ? err.message : String(err);
      await redis.saveThreadState(channelId, state);
      await discordClient.editInteractionResponse(
        interactionToken,
        // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
        "実装中にエラーが発生しました。しばらくしてから再試行してください。",
      );
    }
  }
}
