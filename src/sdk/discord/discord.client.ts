import type { DiscordAdapter } from "@chat-adapter/discord";
import type { Command } from "@/bot/commands/command.interface";
import { getLogger } from "@/shared/utils/logger";

export class DiscordClient {
  private readonly baseUrl = "https://discord.com/api/v10";

  constructor(
    private readonly adapter: DiscordAdapter,
    private readonly botToken: string,
    private readonly applicationId: string,
  ) {}

  private encodeChannelId(channelId: string): string {
    return this.adapter.encodeThreadId({
      channelId,
      guildId: "@me",
    });
  }

  private discordApiFetch(
    path: string,
    method: string,
    body?: unknown,
    authorize = true,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authorize) {
      headers.Authorization = `Bot ${this.botToken}`;
    }
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async sendMessage(channelId: string, content: string): Promise<boolean> {
    const log = getLogger();
    try {
      await this.adapter.postChannelMessage(
        this.encodeChannelId(channelId),
        content,
      );
      return true;
    } catch (e) {
      log.error(
        { err: e instanceof Error ? e.message : String(e), channelId },
        "Failed to send Discord message",
      );
      return false;
    }
  }

  async editInteractionResponse(
    interactionToken: string,
    content: string,
  ): Promise<string | null> {
    const log = getLogger();
    try {
      const response = await this.discordApiFetch(
        `/webhooks/${this.applicationId}/${interactionToken}/messages/@original`,
        "PATCH",
        { content },
        false,
      );

      if (!response.ok) {
        const body = await response.text();
        log.error(
          { status: response.status, body },
          "Failed to edit interaction response",
        );
        return null;
      }

      const data = (await response.json()) as { id?: string };
      return data.id ?? null;
    } catch (e) {
      log.error(
        { err: e instanceof Error ? e.message : String(e) },
        "Interaction followup request failed",
      );
      return null;
    }
  }

  async createThreadFromMessage(
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<string | null> {
    const log = getLogger();
    try {
      const response = await this.discordApiFetch(
        `/channels/${channelId}/messages/${messageId}/threads`,
        "POST",
        { name, auto_archive_duration: 60 },
      );

      if (!response.ok) {
        const body = await response.text();
        log.error(
          { status: response.status, body, channelId, messageId },
          "Failed to create thread",
        );
        return null;
      }

      const data = (await response.json()) as { id?: string };
      return data.id ?? null;
    } catch (e) {
      log.error(
        {
          err: e instanceof Error ? e.message : String(e),
          channelId,
          messageId,
        },
        "Thread creation request failed",
      );
      return null;
    }
  }

  async getFirstMessage(channelId: string): Promise<string | null> {
    const log = getLogger();
    try {
      const result = await this.adapter.fetchChannelMessages(
        this.encodeChannelId(channelId),
        { limit: 50 },
      );

      if (result.messages.length === 0) return null;

      const oldest = result.messages.reduce((a, b) => (a.id < b.id ? a : b));
      return oldest.text ?? null;
    } catch (e) {
      log.error(
        { err: e instanceof Error ? e.message : String(e), channelId },
        "Message fetch request failed",
      );
      return null;
    }
  }

  async isThreadChannel(channelId: string): Promise<boolean> {
    const log = getLogger();
    try {
      const info = await this.adapter.fetchChannelInfo(
        this.encodeChannelId(channelId),
      );
      const channelType = info.metadata.channelType as number | undefined;
      // 11=public thread, 12=private thread, 13=announcement thread
      return (
        channelType !== undefined && channelType >= 11 && channelType <= 13
      );
    } catch (e) {
      log.error(
        { err: e instanceof Error ? e.message : String(e), channelId },
        "Channel fetch request failed",
      );
      return false;
    }
  }

  async sendChannelMessage(
    channelId: string,
    content: string,
  ): Promise<string | null> {
    const log = getLogger();
    try {
      const response = await this.discordApiFetch(
        `/channels/${channelId}/messages`,
        "POST",
        { content },
      );

      if (!response.ok) {
        const body = await response.text();
        log.error(
          { status: response.status, body, channelId },
          "Failed to send channel message",
        );
        return null;
      }

      const data = (await response.json()) as { id?: string };
      return data.id ?? null;
    } catch (e) {
      log.error(
        { err: e instanceof Error ? e.message : String(e), channelId },
        "Channel message request failed",
      );
      return null;
    }
  }

  async archiveThread(threadId: string): Promise<boolean> {
    const log = getLogger();
    try {
      const response = await this.discordApiFetch(
        `/channels/${threadId}`,
        "PATCH",
        { archived: true },
      );

      if (!response.ok) {
        const body = await response.text();
        log.error(
          { status: response.status, body, threadId },
          "Failed to archive thread",
        );
        return false;
      }

      return true;
    } catch (e) {
      log.error(
        { err: e instanceof Error ? e.message : String(e), threadId },
        "Thread archive request failed",
      );
      return false;
    }
  }

  async registerGuildCommands(
    guildId: string,
    commands: Command[],
  ): Promise<void> {
    const log = getLogger();
    const body = commands
      .filter((c) => c.definition)
      .map((c) => ({ name: c.name, ...c.definition }));

    try {
      const response = await this.discordApiFetch(
        `/applications/${this.applicationId}/guilds/${guildId}/commands`,
        "PUT",
        body,
      );

      if (!response.ok) {
        log.error(
          { status: response.status, guildId },
          "Failed to register guild commands",
        );
        return;
      }

      log.info({ guildId, count: body.length }, "Guild commands registered");
    } catch (e) {
      log.error(
        {
          err: e instanceof Error ? e.message : String(e),
          guildId,
        },
        "Guild command registration request failed",
      );
    }
  }
}
