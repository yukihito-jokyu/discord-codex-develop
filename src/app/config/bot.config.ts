import { readFileSync } from "node:fs";
import YAML from "yaml";
import { z } from "zod";

export const logLevelSchema = z.enum([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

export const botConfigSchema = z.object({
  bot: z.object({
    defaultModel: z.string().min(1),
    maxTokens: z.number().int().min(0),
    timeoutMs: z.number().int().min(0),
    allowedUsers: z.array(z.string()).optional(),
  }),
  server: z.object({
    port: z.number().int().min(1),
  }),
  logging: z
    .object({
      level: logLevelSchema.optional(),
    })
    .optional(),
  redis: z
    .object({
      url: z.string().min(1),
    })
    .optional(),
  github: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
  }),
  workspace: z.object({
    root: z.string().min(1),
  }),
  develop: z
    .object({
      codexModel: z.string().min(1).default("codex-mini"),
      timeoutMs: z.number().int().min(0).default(600000),
    })
    .default({ codexModel: "codex-mini", timeoutMs: 600000 }),
});

export type BotConfig = z.infer<typeof botConfigSchema>;

export function loadConfig(path = "src/app/config/config.yaml"): BotConfig {
  const raw = readFileSync(path, "utf-8");
  const parsed = YAML.parse(raw);
  return botConfigSchema.parse(parsed);
}
