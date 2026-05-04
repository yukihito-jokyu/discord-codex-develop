import type { RedisClient } from "@/infrastructure/redis/redis.client";
import type { Phase } from "@/infrastructure/redis/thread-state.types";
import type { WorkspaceManager } from "@/infrastructure/workspace/workspace.manager";
import { deferred, message } from "@/sdk/discord/adapter/response.adapter";
import type { DiscordClient } from "@/sdk/discord/discord.client";
import type {
  DomainInteraction,
  DomainResponse,
} from "@/sdk/discord/types/domain";
import { getLogger } from "@/shared/utils/logger";
import type { Command } from "../command.interface";
import { validateThreadCommand } from "./validate";

interface ResetCommandDeps {
  redis: RedisClient;
  workspace: WorkspaceManager;
  discordClient: DiscordClient;
}

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

  constructor(private readonly deps: ResetCommandDeps) {}

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
    const log = getLogger();
    const { redis, workspace, discordClient } = this.deps;
    const channelId = interaction.channelId;

    const vr = await validateThreadCommand({
      discordClient,
      redis,
      channelId,
      userId: interaction.userId,
      expectedPhases: ALL_PHASES,
      interactionToken,
    });
    if (!vr) return;

    const discardResult = await workspace.discardChanges(
      vr.state.workspacePath,
    );
    if (!discardResult.ok) {
      await discordClient.editInteractionResponse(
        interactionToken,
        `変更の破棄に失敗しました: ${discardResult.error.message}`,
      );
      return;
    }

    await discordClient.editInteractionResponse(
      interactionToken,
      // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
      "ワークスペースの変更を破棄しました。",
    );

    log.info(
      { channelId, issueNumber: vr.state.issueNumber },
      "ResetCommand completed",
    );
  }
}
