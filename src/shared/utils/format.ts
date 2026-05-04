import { DISCORD_MAX_LENGTH } from "./constants";
import { truncateToBytes } from "./truncate";

// biome-ignore lint/security/noSecrets: static Japanese notice text, not a secret
const DISCORD_OMISSION_NOTICE = "\n\n... (続きは省略されました)";

export function formatForDiscord(text: string): string {
  return truncateToBytes(text, DISCORD_MAX_LENGTH, DISCORD_OMISSION_NOTICE)
    .text;
}
