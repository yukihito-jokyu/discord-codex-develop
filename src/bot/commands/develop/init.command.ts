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

interface InitCommandDeps {
  redis: RedisClient;
  github: GitHubClient;
  workspace: WorkspaceManager;
  discordClient: DiscordClient;
  githubOwner: string;
  githubRepo: string;
}

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

  constructor(private readonly deps: InitCommandDeps) {}

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

  private async validate(
    interaction: DomainInteraction,
    interactionToken: string,
  ): Promise<{ issueNumber: number } | null> {
    const { redis, discordClient } = this.deps;
    const channelId = interaction.channelId;
    const userId = interaction.userId;

    const issueNumber = Number(interaction.options?.["issue-number"]);
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      await discordClient.editInteractionResponse(
        interactionToken,
        // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
        "Issue番号は正の整数で指定してください。",
      );
      return null;
    }

    const inThread = await discordClient.isThreadChannel(channelId);
    if (inThread) {
      await discordClient.editInteractionResponse(
        interactionToken,
        // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
        "このコマンドはスレッド外のチャンネルで実行してください。",
      );
      return null;
    }

    const existingState = await redis.getThreadState(channelId);
    if (existingState && existingState.subStage === "running") {
      await discordClient.editInteractionResponse(
        interactionToken,
        // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
        "現在別の処理が実行中です。完了してから再試行してください。",
      );
      return null;
    }

    if (existingState && existingState.initiatedBy !== userId) {
      await discordClient.editInteractionResponse(
        interactionToken,
        // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
        "このワークフローは別のユーザーが初期化しました。",
      );
      return null;
    }

    return { issueNumber };
  }

  private async setupWorkspace(
    interactionToken: string,
    issueNumber: number,
  ): Promise<{
    branchName: string;
    targetDir: string;
  } | null> {
    const { workspace, discordClient, githubOwner, githubRepo } = this.deps;
    const branchName = `feature/${issueNumber}`;
    const targetDir = `${githubRepo}-${issueNumber}`;
    const repoUrl = `https://github.com/${githubOwner}/${githubRepo}.git`;

    const cloneResult = await workspace.ensureClone(repoUrl, targetDir);
    if (!cloneResult.ok) {
      await discordClient.editInteractionResponse(
        interactionToken,
        `リポジトリのcloneに失敗しました: ${cloneResult.error.message}`,
      );
      return null;
    }

    const syncResult = await workspace.syncMain(targetDir);
    if (!syncResult.ok) {
      await discordClient.editInteractionResponse(
        interactionToken,
        `mainブランチの同期に失敗しました: ${syncResult.error.message}`,
      );
      return null;
    }

    const branchResult = await workspace.createBranch(targetDir, branchName);
    if (!branchResult.ok) {
      await discordClient.editInteractionResponse(
        interactionToken,
        `ブランチの作成に失敗しました: ${branchResult.error.message}`,
      );
      return null;
    }

    return { branchName, targetDir };
  }

  private async createThreadAndSaveState(options: {
    interactionToken: string;
    channelId: string;
    userId: string;
    issueNumber: number;
    issue: import("@/infrastructure/github/github.client").IssueInfo;
    ws: { branchName: string; targetDir: string };
  }): Promise<void> {
    const { interactionToken, channelId, userId, issueNumber, issue, ws } =
      options;
    const { redis, discordClient, githubOwner, githubRepo } = this.deps;
    const log = getLogger();
    // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
    const noBodyText = "(本文なし)";
    const initMessage = `**Issue #${issueNumber}: ${issue.title}**\n\n${issue.body ? formatForDiscord(issue.body) : noBodyText}`;
    const messageId = await discordClient.editInteractionResponse(
      interactionToken,
      initMessage,
    );

    let threadId = channelId;
    if (messageId) {
      const createdThreadId = await discordClient.createThreadFromMessage(
        channelId,
        messageId,
        `Issue #${issueNumber}: ${issue.title}`.slice(0, 100),
      );
      if (createdThreadId) threadId = createdThreadId;
    }

    const initialState: ThreadState = {
      initiatedBy: userId,
      issueNumber,
      repo: `${githubOwner}/${githubRepo}`,
      branch: ws.branchName,
      workspacePath: ws.targetDir,
      currentPhase: "init",
      subStage: "idle",
      lastError: null,
      planOutput: null,
    };

    await redis.saveThreadState(threadId, initialState);
    log.info(
      { threadId, issueNumber, branch: ws.branchName },
      "InitCommand completed",
    );
  }

  private async processInBackground(
    interaction: DomainInteraction,
    interactionToken: string,
  ): Promise<void> {
    const { github, discordClient, githubOwner, githubRepo } = this.deps;
    const channelId = interaction.channelId;

    const validated = await this.validate(interaction, interactionToken);
    if (!validated) return;

    const issueResult = await github.getIssue(
      githubOwner,
      githubRepo,
      validated.issueNumber,
    );
    if (!issueResult.ok) {
      await discordClient.editInteractionResponse(
        interactionToken,
        `Issue #${validated.issueNumber} の取得に失敗しました: ${issueResult.error.message}`,
      );
      return;
    }

    const ws = await this.setupWorkspace(
      interactionToken,
      validated.issueNumber,
    );
    if (!ws) return;

    await this.createThreadAndSaveState({
      interactionToken,
      channelId,
      userId: interaction.userId,
      issueNumber: validated.issueNumber,
      issue: issueResult.value,
      ws,
    });
  }
}
