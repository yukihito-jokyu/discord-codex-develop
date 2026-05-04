import { createDiscordAdapter } from "@chat-adapter/discord";
import { CodexExecClient } from "@/ai/client/codex-exec.client";
import { OpenAIClient } from "@/ai/client/openai.client";
import { AIService } from "@/ai/services/ai.service";
import { DevelopService } from "@/ai/services/develop.service";
import { SummaryService } from "@/ai/services/summary.service";
import { type BotConfig, loadConfig } from "@/app/config/bot.config";
import { env } from "@/app/config/env";
import { ChatCommand } from "@/bot/commands/ai/chat.command";
import { SummaryCommand } from "@/bot/commands/ai/summary.command";
import type { Command } from "@/bot/commands/command.interface";
import { CommitCommand } from "@/bot/commands/develop/commit.command";
import { DevelopCommand } from "@/bot/commands/develop/develop.command";
import { InitCommand } from "@/bot/commands/develop/init.command";
import { PlanCommand } from "@/bot/commands/develop/plan.command";
import { PrCommand } from "@/bot/commands/develop/pr.command";
import { ResetCommand } from "@/bot/commands/develop/reset.command";
import { TestCommand } from "@/bot/commands/develop/test.command";
import { PingCommand } from "@/bot/commands/utility/ping.command";
import { InteractionHandler } from "@/bot/handlers/interaction.handler";
import { MessageHandler } from "@/bot/handlers/message.handler";
import { Router } from "@/bot/router";
import { GitHubClient } from "@/infrastructure/github/github.client";
import { RedisClient } from "@/infrastructure/redis/redis.client";
import { WebFetcherClient } from "@/infrastructure/web/web-fetcher.client";
import { WorkspaceManager } from "@/infrastructure/workspace/workspace.manager";
import { DiscordClient } from "@/sdk/discord/discord.client";
import { DiscordGateway } from "@/server/gateway/discord.gateway";
import { createApp } from "@/server/hono";
import { createLogger, getLogger } from "@/shared/utils/logger";

function getCodexApiKey(): string {
  const key = env.CODEX_API_KEY ?? env.OPENAI_API_KEY;
  if (!key) throw new Error("CODEX_API_KEY or OPENAI_API_KEY is required");
  return key;
}

function createAIService(): {
  aiService: AIService;
  redis: RedisClient;
  openai: OpenAIClient;
} {
  const codexApiKey = getCodexApiKey();
  const openai = new OpenAIClient(codexApiKey, {
    baseUrl: env.CODEX_BASE_URL,
    model: env.CODEX_MODEL,
  });
  const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";
  const redis = new RedisClient(redisUrl);
  redis.connect().catch((err) => {
    getLogger().warn({ err: String(err) }, "Redis connection failed");
  });
  return { aiService: new AIService(openai, redis), redis, openai };
}

function createDevelopService(
  config: BotConfig,
  redis: RedisClient,
): DevelopService {
  const codexApiKey = getCodexApiKey();
  const codexExec = new CodexExecClient(codexApiKey, {
    baseUrl: env.CODEX_BASE_URL,
    model: config.develop.codexModel,
  });
  const github = new GitHubClient();
  const workspace = new WorkspaceManager(config.workspace.root);
  return new DevelopService({
    redis,
    codexExec,
    github,
    workspace,
    githubOwner: config.github.owner,
    githubRepo: config.github.repo,
  });
}

function createDevelopCommands(
  developService: DevelopService,
  discordClient: DiscordClient,
): Command[] {
  return [
    new InitCommand(developService, discordClient),
    new PlanCommand(developService, discordClient),
    new DevelopCommand(developService, discordClient),
    new TestCommand(developService, discordClient),
    new CommitCommand(developService, discordClient),
    new PrCommand(developService, discordClient),
    new ResetCommand(developService, discordClient),
  ];
}

function createDiscordDeps(
  aiService: AIService,
  openai: OpenAIClient,
  redis: RedisClient,
  config: BotConfig,
) {
  const botToken = env.DISCORD_BOT_TOKEN;
  const applicationId = env.DISCORD_APPLICATION_ID;
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN is required");
  if (!applicationId) throw new Error("DISCORD_APPLICATION_ID is required");

  const adapter = createDiscordAdapter({ botToken, applicationId });
  const discordClient = new DiscordClient(adapter, botToken, applicationId);

  const chatCommand = new ChatCommand(aiService, discordClient);
  const summaryService = new SummaryService(openai, new WebFetcherClient());
  const summaryCommand = new SummaryCommand(summaryService, discordClient);
  const developCommands = createDevelopCommands(
    createDevelopService(config, redis),
    discordClient,
  );

  const commands: Command[] = [
    new PingCommand(),
    chatCommand,
    summaryCommand,
    ...developCommands,
  ];

  const messageHandler = new MessageHandler(
    aiService,
    discordClient,
    applicationId,
  );
  const router = new Router(commands);
  const interactionHandler = new InteractionHandler(router);

  const guildId = env.DISCORD_GUILD_ID;
  if (guildId) {
    discordClient
      .registerGuildCommands(guildId, commands)
      .catch((err: unknown) => {
        getLogger().error(
          { err: String(err) },
          "Guild command registration failed",
        );
      });
  }

  return {
    botToken,
    applicationId,
    interactionHandler,
    messageHandler,
    discordClient,
  };
}

export function bootstrap() {
  const config = loadConfig();
  createLogger(config.logging);
  const log = getLogger();
  log.debug({ config }, "Config loaded");

  const { aiService, redis, openai } = createAIService();
  const {
    botToken,
    applicationId,
    interactionHandler,
    messageHandler,
    discordClient,
  } = createDiscordDeps(aiService, openai, redis, config);

  const app = createApp({
    interactionHandler,
    messageHandler,
    discordClient,
    botToken,
    applicationId,
    allowedUsers: config.bot.allowedUsers,
  });

  const gateway = new DiscordGateway();
  const webhookUrl = `http://localhost:${config.server.port}/api/webhooks/discord`;
  gateway.start(webhookUrl).catch((err) => {
    log.error({ err: String(err) }, "Gateway startup failed");
  });

  log.info({ port: config.server.port }, "Bootstrap completed");

  const shutdown = async () => {
    log.info("Shutting down");
    await redis.disconnect();
    gateway.stop();
  };

  return { app, port: config.server.port, shutdown };
}
