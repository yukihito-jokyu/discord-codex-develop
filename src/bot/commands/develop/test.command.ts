import type { CodexExecClient } from "@/ai/client/codex-exec.client";
import { buildDevelopTestPrompt } from "@/ai/prompts/templates/develop-test";
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

interface TestCommandDeps {
  redis: RedisClient;
  codexExec: CodexExecClient;
  workspace: WorkspaceManager;
  discordClient: DiscordClient;
}

export class TestCommand implements Command {
  readonly name = "test";
  readonly definition = {
    // biome-ignore lint/security/noSecrets: static Japanese UI text, not a secret
    description: "実装に対するテストを作成・実行",
  };

  constructor(private readonly deps: TestCommandDeps) {}

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
      log.error({ err: String(err) }, "TestCommand background error");
    });

    return Promise.resolve(deferred());
  }

  private async runCodexTest(
    state: ThreadState,
    channelId: string,
  ): Promise<import("@/ai/client/codex-exec.client").CodexExecResult> {
    const { redis, codexExec, workspace } = this.deps;

    const diffResult = await workspace.getDiff(state.workspacePath);
    if (!diffResult.ok) {
      throw new Error(`diffの取得に失敗しました: ${diffResult.error.message}`);
    }

    const prompt = buildDevelopTestPrompt({
      diff: diffResult.value,
      repo: state.repo,
      branch: state.branch,
    });

    return executeCodexOrResume({
      codexExec,
      redis,
      channelId,
      phase: "test",
      prompt,
      cwd: state.workspacePath,
      sandboxMode: "write",
    });
  }

  private async executeTest(
    state: ThreadState,
    channelId: string,
    interactionToken: string,
  ): Promise<void> {
    const log = getLogger();
    const { redis, workspace, discordClient } = this.deps;

    const codexResult = await this.runCodexTest(state, channelId);

    const postDiffResult = await workspace.getDiff(state.workspacePath);
    const postDiffText = postDiffResult.ok ? postDiffResult.value : "";

    state.subStage = "idle";
    const casSuccess = await redis.compareAndSwapPhase(
      channelId,
      "developed",
      "tested",
    );
    if (!casSuccess) state.currentPhase = "tested";

    await redis.saveThreadState(channelId, state);

    const responseText = postDiffText
      ? `**テスト作成完了**\n\n\`\`\`diff\n${formatForDiscord(postDiffText)}\n\`\`\``
      : formatForDiscord(codexResult.response);
    await discordClient.editInteractionResponse(interactionToken, responseText);

    log.info(
      { channelId, issueNumber: state.issueNumber },
      "TestCommand completed",
    );
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
      expectedPhases: ["developed"],
      interactionToken,
    });
    if (!vr) return;

    const state = vr.state;
    state.subStage = "running";
    await redis.saveThreadState(channelId, state);

    try {
      await this.executeTest(state, channelId, interactionToken);
    } catch (err) {
      log.error({ err: String(err) }, "TestCommand error");
      state.subStage = "idle";
      state.lastError = err instanceof Error ? err.message : String(err);
      await redis.saveThreadState(channelId, state);
      await discordClient.editInteractionResponse(
        interactionToken,
        // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
        "テスト作成中にエラーが発生しました。しばらくしてから再試行してください。",
      );
    }
  }
}
