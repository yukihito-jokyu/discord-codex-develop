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

export class InitCommand implements Command {
  readonly name = "init";
  readonly definition = {
    // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
    description: "Issueから開発ワークフローを初期化",
    options: [
      {
        name: "issue-number",
        description: "Issue番号",
        type: 4 as const,
        required: true,
      },
    ],
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
      log.error({ err: String(err) }, "InitCommand background error");
    });

    return Promise.resolve(deferred());
  }

  private async processInBackground(
    interaction: DomainInteraction,
    interactionToken: string,
  ): Promise<void> {
    const channelId = interaction.channelId;
    const userId = interaction.userId;
    const issueNumber = Number(interaction.options?.["issue-number"]);

    const inThread = await this.discordClient.isThreadChannel(channelId);
    if (inThread) {
      await this.discordClient.editInteractionResponse(
        interactionToken,
        // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
        "このコマンドはスレッド外のチャンネルで実行してください。",
      );
      return;
    }

    const initValid = await this.developService.validateInit({
      channelId,
      userId,
      issueNumber,
    });
    if (!initValid.ok) {
      await this.discordClient.editInteractionResponse(
        interactionToken,
        initValid.error.message,
      );
      return;
    }

    await this.setupAndInitialize(
      channelId,
      userId,
      issueNumber,
      interactionToken,
    );
  }

  private async setupAndInitialize(
    channelId: string,
    userId: string,
    issueNumber: number,
    interactionToken: string,
  ): Promise<void> {
    const issueResult = await this.developService.fetchIssue(issueNumber);
    if (!issueResult.ok) {
      await this.discordClient.editInteractionResponse(
        interactionToken,
        `Issue #${issueNumber} の取得に失敗しました: ${issueResult.error.message}`,
      );
      return;
    }

    const wsResult = await this.developService.setupWorkspace(issueNumber);
    if (!wsResult.ok) {
      await this.discordClient.editInteractionResponse(
        interactionToken,
        `ワークスペースの準備に失敗しました: ${wsResult.error.message}`,
      );
      return;
    }

    // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
    const noBodyText = "(本文なし)";
    const issue = issueResult.value;
    const initMessage = `**Issue #${issueNumber}: ${issue.title}**\n\n${issue.body ? formatForDiscord(issue.body) : noBodyText}`;
    const messageId = await this.discordClient.editInteractionResponse(
      interactionToken,
      initMessage,
    );

    let threadId = channelId;
    if (messageId) {
      const createdThreadId = await this.discordClient.createThreadFromMessage(
        channelId,
        messageId,
        `Issue #${issueNumber}: ${issue.title}`.slice(0, 100),
      );
      if (createdThreadId) threadId = createdThreadId;
    }

    await this.developService.initializeState({
      channelId: threadId,
      userId,
      issueNumber,
      branchName: wsResult.value.branchName,
      targetDir: wsResult.value.targetDir,
    });

    const log = getLogger();
    log.info(
      { threadId, issueNumber, branch: wsResult.value.branchName },
      "InitCommand completed",
    );
  }
}
