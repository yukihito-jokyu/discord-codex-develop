import type { DevelopService } from "@/ai/services/develop.service";
import type { Phase } from "@/infrastructure/redis/thread-state.types";
import { deferred, message } from "@/sdk/discord/adapter/response.adapter";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type {
  DomainInteraction,
  DomainResponse,
} from "@/sdk/discord/types/domain";
import { getLogger } from "@/shared/utils/logger";
import type { Command } from "../command.interface";

const ALL_PHASES: Phase[] = [
  "init",
  "planned",
  "developed",
  "tested",
  "committed",
  "completed",
];

export class ResetCommand implements Command {
  readonly name = "reset";
  readonly definition = {
    // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
    description: "ワークスペースの変更を破棄",
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
      log.error({ err: String(err) }, "ResetCommand background error");
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
      expectedPhases: ALL_PHASES,
    });
    if (!vr.ok) {
      await this.discordClient.editInteractionResponse(
        interactionToken,
        vr.error.message,
      );
      return;
    }

    const discardResult = await this.developService.discardChanges(
      vr.value.state,
    );
    if (!discardResult.ok) {
      await this.discordClient.editInteractionResponse(
        interactionToken,
        `変更の破棄に失敗しました: ${discardResult.error.message}`,
      );
      return;
    }

    await this.discordClient.editInteractionResponse(
      interactionToken,
      // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
      "ワークスペースの変更を破棄しました。",
    );

    const log = getLogger();
    log.info(
      { channelId, issueNumber: vr.value.state.issueNumber },
      "ResetCommand completed",
    );
  }
}
