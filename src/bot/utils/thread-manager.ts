import type { DiscordClient } from "@/sdk/discord/discord.client";
import { getLogger } from "@/shared/utils/logger";

const THREAD_NAME_MAX_LENGTH = 100;

export class ThreadManager {
  constructor(private readonly discordClient: DiscordClient) {}

  async createDevThread(
    channelId: string,
    issueNumber: number,
    issueTitle: string,
  ): Promise<string | null> {
    const log = getLogger();
    const rawName = `#${issueNumber} ${issueTitle}`;
    const threadName = rawName.slice(0, THREAD_NAME_MAX_LENGTH);

    const messageId = await this.discordClient.sendChannelMessage(
      channelId,
      `Issue #${issueNumber} 開発スレッド`,
    );
    if (!messageId) {
      log.error(
        { channelId, issueNumber },
        "Failed to send initial message for dev thread",
      );
      return null;
    }

    const threadId = await this.discordClient.createThreadFromMessage(
      channelId,
      messageId,
      threadName,
    );
    if (!threadId) {
      log.error(
        { channelId, issueNumber, messageId },
        "Failed to create dev thread",
      );
      return null;
    }

    log.info({ threadId, issueNumber, threadName }, "Dev thread created");
    return threadId;
  }

  async archiveThread(threadId: string): Promise<void> {
    const log = getLogger();
    const success = await this.discordClient.archiveThread(threadId);
    if (!success) {
      log.error({ threadId }, "Failed to archive thread");
    }
  }
}
