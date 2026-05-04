import type { DevelopService } from "@/ai/services/develop.service";
import { deferred, message } from "@/sdk/discord/adapter/response.adapter";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type {
  DomainInteraction,
  DomainResponse,
} from "@/sdk/discord/types/domain";
import { formatForDiscord } from "@/shared/utils/format";
import { getLogger } from "@/shared/utils/logger";
import type { Command } from "../command.interface";

const ALLOWED_PHASES = ["init", "planned"] as const;

export class PlanCommand implements Command {
  readonly name = "plan";
  readonly definition = {
    // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
    description: "Issueに基づいて実装計画を作成",
  };

  constructor(
    private readonly developService: DevelopService,
    private readonly discordClient: DiscordClient,
  ) {}

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

  private async processInBackground(
    interaction: DomainInteraction,
    interactionToken: string,
  ): Promise<void> {
    const channelId = interaction.channelId;

    const inThread = await this.discordClient.isThreadChannel(channelId);
    if (!inThread) {
      await this.discordClient.editInteractionResponse(
        interactionToken,
        // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
        "このコマンドはスレッド内で実行してください。",
      );
      return;
    }

    const vr = await this.developService.validateThreadCommand({
      channelId,
      userId: interaction.userId,
      expectedPhases: [...ALLOWED_PHASES],
    });
    if (!vr.ok) {
      await this.discordClient.editInteractionResponse(
        interactionToken,
        vr.error.message,
      );
      return;
    }

    await this.developService.setRunning(channelId, vr.value.state);
    await this.executePlanPhase(channelId, vr.value.state, interactionToken);
  }

  private async executePlanPhase(
    channelId: string,
    state: import("@/infrastructure/redis/thread-state.types").ThreadState,
    interactionToken: string,
  ): Promise<void> {
    try {
      const result = await this.developService.executePlan(channelId, state);
      if (!result.ok) {
        await this.developService.setError(
          channelId,
          state,
          result.error.message,
        );
        await this.discordClient.editInteractionResponse(
          interactionToken,
          result.error.message,
        );
        return;
      }
      await this.discordClient.editInteractionResponse(
        interactionToken,
        formatForDiscord(result.value.response),
      );
    } catch (err) {
      const log = getLogger();
      log.error({ err: String(err) }, "PlanCommand error");
      await this.developService.setError(
        channelId,
        state,
        err instanceof Error ? err.message : String(err),
      );
      await this.discordClient.editInteractionResponse(
        interactionToken,
        // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
        "計画の作成中にエラーが発生しました。しばらくしてから再試行してください。",
      );
    }
  }
}
