import type { RedisClient } from "@/infrastructure/redis/redis.client";
import type {
  Phase,
  ThreadState,
} from "@/infrastructure/redis/thread-state.types";
import type { DiscordClient } from "@/sdk/discord/discord.client";

export interface ValidationResult {
  state: ThreadState;
}

export interface ValidateThreadOptions {
  discordClient: DiscordClient;
  redis: RedisClient;
  channelId: string;
  userId: string;
  expectedPhases: Phase[];
  interactionToken: string;
}

export async function validateThreadCommand(
  options: ValidateThreadOptions,
): Promise<ValidationResult | null> {
  const {
    discordClient,
    redis,
    channelId,
    userId,
    expectedPhases,
    interactionToken,
  } = options;
  const inThread = await discordClient.isThreadChannel(channelId);
  if (!inThread) {
    await discordClient.editInteractionResponse(
      interactionToken,
      // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
      "このコマンドはスレッド内で実行してください。",
    );
    return null;
  }

  const state = await redis.getThreadState(channelId);
  if (!state) {
    await discordClient.editInteractionResponse(
      interactionToken,
      // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
      "ワークフローが初期化されていません。先に `/init` を実行してください。",
    );
    return null;
  }

  if (state.initiatedBy !== userId) {
    await discordClient.editInteractionResponse(
      interactionToken,
      // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
      "このワークフローの実行者のみが操作できます。",
    );
    return null;
  }

  if (!expectedPhases.includes(state.currentPhase)) {
    await discordClient.editInteractionResponse(
      interactionToken,
      `現在のフェーズが不正です (現在: ${state.currentPhase}, 期待: ${expectedPhases.join(" または ")})`,
    );
    return null;
  }

  if (state.subStage === "running") {
    await discordClient.editInteractionResponse(
      interactionToken,
      // biome-ignore lint/security/noSecrets: static Japanese error message, not a secret
      "現在別の処理が実行中です。完了してから再試行してください。",
    );
    return null;
  }

  return { state };
}

export interface ExecuteCodexOptions {
  codexExec: import("@/ai/client/codex-exec.client").CodexExecClient;
  redis: RedisClient;
  channelId: string;
  phase: string;
  prompt: string;
  cwd: string;
  sandboxMode: "read-only" | "write";
}

export async function executeCodexOrResume(
  options: ExecuteCodexOptions,
): Promise<import("@/ai/client/codex-exec.client").CodexExecResult> {
  const { codexExec, redis, channelId, phase, prompt, cwd, sandboxMode } =
    options;
  const existingThreadId = await redis.getCodexThread(channelId, phase);
  const execOptions = { prompt, cwd, sandboxMode };

  const result = existingThreadId
    ? await codexExec.resumeThread(existingThreadId, prompt, execOptions)
    : await codexExec.startThread(prompt, execOptions);

  await redis.saveCodexThread(channelId, phase, result.threadId);
  return result;
}
