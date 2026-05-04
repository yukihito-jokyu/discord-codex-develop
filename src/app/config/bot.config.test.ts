import { beforeEach, describe, expect, it, vi } from "vitest";
import { botConfigSchema } from "@/app/config/bot.config";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

const github = { owner: "test-owner", repo: "test-repo" };
const workspace = { root: "/tmp/workspace" };

const validYaml = `
bot:
  defaultModel: "codex-mini"
  maxTokens: 4096
  timeoutMs: 30000
server:
  port: 3000
github:
  owner: "test-owner"
  repo: "test-repo"
workspace:
  root: "/tmp/workspace"
redis:
  url: "redis://localhost:6379"
`;

describe("botConfigSchema valid", () => {
  it("parses valid config", () => {
    const result = botConfigSchema.parse({
      bot: {
        defaultModel: "codex-mini",
        maxTokens: 4096,
        timeoutMs: 30000,
      },
      server: { port: 3000 },
      github,
      workspace,
    });

    expect(result).toEqual({
      bot: {
        defaultModel: "codex-mini",
        maxTokens: 4096,
        timeoutMs: 30000,
      },
      server: { port: 3000 },
      github,
      workspace,
      develop: { codexModel: "codex-mini", timeoutMs: 600000 },
    });
  });

  it("accepts maxTokens of 0", () => {
    const result = botConfigSchema.parse({
      bot: { defaultModel: "model", maxTokens: 0, timeoutMs: 30000 },
      server: { port: 3000 },
      github,
      workspace,
    });

    expect(result.bot.maxTokens).toBe(0);
  });

  it("accepts timeoutMs of 0", () => {
    const result = botConfigSchema.parse({
      bot: { defaultModel: "model", maxTokens: 4096, timeoutMs: 0 },
      server: { port: 3000 },
      github,
      workspace,
    });

    expect(result.bot.timeoutMs).toBe(0);
  });
});

describe("botConfigSchema allowedUsers", () => {
  it("accepts valid allowedUsers array", () => {
    const result = botConfigSchema.parse({
      bot: {
        defaultModel: "codex-mini",
        maxTokens: 4096,
        timeoutMs: 30000,
        allowedUsers: ["user-1", "user-2"],
      },
      server: { port: 3000 },
      github,
      workspace,
    });

    expect(result.bot.allowedUsers).toEqual(["user-1", "user-2"]);
  });

  it("accepts config without allowedUsers", () => {
    const result = botConfigSchema.parse({
      bot: { defaultModel: "codex-mini", maxTokens: 4096, timeoutMs: 30000 },
      server: { port: 3000 },
      github,
      workspace,
    });

    expect(result.bot.allowedUsers).toBeUndefined();
  });

  it("accepts empty allowedUsers array", () => {
    const result = botConfigSchema.parse({
      bot: {
        defaultModel: "codex-mini",
        maxTokens: 4096,
        timeoutMs: 30000,
        allowedUsers: [],
      },
      server: { port: 3000 },
      github,
      workspace,
    });

    expect(result.bot.allowedUsers).toEqual([]);
  });

  it("rejects non-array allowedUsers", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: {
          defaultModel: "codex-mini",
          maxTokens: 4096,
          timeoutMs: 30000,
          allowedUsers: "not-an-array",
        },
        server: { port: 3000 },
        github,
        workspace,
      }),
    ).toThrow();
  });

  it("rejects allowedUsers with non-string elements", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: {
          defaultModel: "codex-mini",
          maxTokens: 4096,
          timeoutMs: 30000,
          allowedUsers: [123],
        },
        server: { port: 3000 },
        github,
        workspace,
      }),
    ).toThrow();
  });
});

describe("botConfigSchema invalid bot fields", () => {
  it("rejects missing bot.defaultModel", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: { maxTokens: 4096, timeoutMs: 30000 },
        server: { port: 3000 },
        github,
        workspace,
      }),
    ).toThrow();
  });

  it("rejects empty string for defaultModel", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: { defaultModel: "", maxTokens: 4096, timeoutMs: 30000 },
        server: { port: 3000 },
        github,
        workspace,
      }),
    ).toThrow();
  });

  it("rejects wrong type for maxTokens", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: {
          defaultModel: "codex-mini",
          maxTokens: "not-a-number",
          timeoutMs: 30000,
        },
        server: { port: 3000 },
        github,
        workspace,
      }),
    ).toThrow();
  });

  it("rejects negative maxTokens", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: { defaultModel: "codex-mini", maxTokens: -1, timeoutMs: 30000 },
        server: { port: 3000 },
        github,
        workspace,
      }),
    ).toThrow();
  });
});

describe("botConfigSchema invalid server fields", () => {
  it("rejects missing server.port", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: {
          defaultModel: "codex-mini",
          maxTokens: 4096,
          timeoutMs: 30000,
        },
        server: {},
        github,
        workspace,
      }),
    ).toThrow();
  });

  it("rejects port of 0", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: { defaultModel: "codex-mini", maxTokens: 4096, timeoutMs: 30000 },
        server: { port: 0 },
        github,
        workspace,
      }),
    ).toThrow();
  });

  it("rejects negative server.port", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: { defaultModel: "codex-mini", maxTokens: 4096, timeoutMs: 30000 },
        server: { port: -1 },
        github,
        workspace,
      }),
    ).toThrow();
  });
});

describe("botConfigSchema logging valid", () => {
  it("accepts config without logging section", () => {
    const result = botConfigSchema.parse({
      bot: { defaultModel: "codex-mini", maxTokens: 4096, timeoutMs: 30000 },
      server: { port: 3000 },
      github,
      workspace,
    });

    expect(result).not.toHaveProperty("logging");
  });

  it.each([
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
    "silent",
  ])("accepts logging with valid level %s", (level) => {
    const result = botConfigSchema.parse({
      bot: {
        defaultModel: "codex-mini",
        maxTokens: 4096,
        timeoutMs: 30000,
      },
      server: { port: 3000 },
      logging: { level },
      github,
      workspace,
    });

    expect(result.logging?.level).toBe(level);
  });

  it("accepts logging without level", () => {
    const result = botConfigSchema.parse({
      bot: { defaultModel: "codex-mini", maxTokens: 4096, timeoutMs: 30000 },
      server: { port: 3000 },
      logging: {},
      github,
      workspace,
    });

    expect(result.logging).toEqual({});
  });
});

describe("botConfigSchema logging invalid", () => {
  it("rejects invalid log level string", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: {
          defaultModel: "codex-mini",
          maxTokens: 4096,
          timeoutMs: 30000,
        },
        server: { port: 3000 },
        logging: { level: "verbose" },
        github,
        workspace,
      }),
    ).toThrow();
  });

  it("rejects non-string log level", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: {
          defaultModel: "codex-mini",
          maxTokens: 4096,
          timeoutMs: 30000,
        },
        server: { port: 3000 },
        logging: { level: 123 },
        github,
        workspace,
      }),
    ).toThrow();
  });
});

describe("botConfigSchema redis valid", () => {
  it("accepts config without redis section", () => {
    const result = botConfigSchema.parse({
      bot: { defaultModel: "codex-mini", maxTokens: 4096, timeoutMs: 30000 },
      server: { port: 3000 },
      github,
      workspace,
    });

    expect(result).not.toHaveProperty("redis");
  });

  it("accepts valid redis.url", () => {
    const result = botConfigSchema.parse({
      bot: { defaultModel: "codex-mini", maxTokens: 4096, timeoutMs: 30000 },
      server: { port: 3000 },
      redis: { url: "redis://localhost:6379" },
      github,
      workspace,
    });

    expect(result.redis?.url).toBe("redis://localhost:6379");
  });
});

describe("botConfigSchema redis invalid", () => {
  it("rejects empty string for redis.url", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: { defaultModel: "codex-mini", maxTokens: 4096, timeoutMs: 30000 },
        server: { port: 3000 },
        redis: { url: "" },
        github,
        workspace,
      }),
    ).toThrow();
  });

  it("rejects non-string redis.url", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: { defaultModel: "codex-mini", maxTokens: 4096, timeoutMs: 30000 },
        server: { port: 3000 },
        redis: { url: 123 },
        github,
        workspace,
      }),
    ).toThrow();
  });
});

async function setupLoadConfig(mockValue: string) {
  const { readFileSync } = await import("node:fs");
  vi.mocked(readFileSync).mockReturnValue(mockValue);
  return import("@/app/config/bot.config");
}

describe("loadConfig", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("parses valid YAML config", async () => {
    const { loadConfig } = await setupLoadConfig(validYaml);

    const config = loadConfig();

    expect(config).toEqual({
      bot: {
        defaultModel: "codex-mini",
        maxTokens: 4096,
        timeoutMs: 30000,
      },
      server: { port: 3000 },
      github,
      workspace,
      redis: { url: "redis://localhost:6379" },
      develop: { codexModel: "codex-mini", timeoutMs: 600000 },
    });
  });

  it("reads from default path", async () => {
    const { loadConfig } = await setupLoadConfig(validYaml);
    const { readFileSync } = await import("node:fs");

    loadConfig();

    expect(readFileSync).toHaveBeenCalledWith(
      "src/app/config/config.yaml",
      "utf-8",
    );
  });

  it("reads from custom path", async () => {
    const { loadConfig } = await setupLoadConfig(validYaml);
    const { readFileSync } = await import("node:fs");

    loadConfig("custom/path.yaml");

    expect(readFileSync).toHaveBeenCalledWith("custom/path.yaml", "utf-8");
  });

  it("throws on non-existent file", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    const { loadConfig } = await import("@/app/config/bot.config");

    expect(() => loadConfig("nonexistent.yaml")).toThrow("ENOENT");
  });
});

describe("botConfigSchema develop valid", () => {
  it("accepts config without develop section", () => {
    const result = botConfigSchema.parse({
      bot: { defaultModel: "codex-mini", maxTokens: 4096, timeoutMs: 30000 },
      server: { port: 3000 },
      github,
      workspace,
    });

    expect(result.develop).toEqual({
      codexModel: "codex-mini",
      timeoutMs: 600000,
    });
  });

  it("accepts develop with custom values", () => {
    const result = botConfigSchema.parse({
      bot: { defaultModel: "codex-mini", maxTokens: 4096, timeoutMs: 30000 },
      server: { port: 3000 },
      github,
      workspace,
      develop: { codexModel: "gpt-4", timeoutMs: 300000 },
    });

    expect(result.develop).toEqual({
      codexModel: "gpt-4",
      timeoutMs: 300000,
    });
  });

  it("applies defaults for partial develop config", () => {
    const result = botConfigSchema.parse({
      bot: { defaultModel: "codex-mini", maxTokens: 4096, timeoutMs: 30000 },
      server: { port: 3000 },
      github,
      workspace,
      develop: { codexModel: "custom-model" },
    });

    expect(result.develop).toEqual({
      codexModel: "custom-model",
      timeoutMs: 600000,
    });
  });
});

describe("botConfigSchema develop invalid", () => {
  it("rejects empty string for codexModel", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: {
          defaultModel: "codex-mini",
          maxTokens: 4096,
          timeoutMs: 30000,
        },
        server: { port: 3000 },
        github,
        workspace,
        develop: { codexModel: "" },
      }),
    ).toThrow();
  });

  it("rejects negative timeoutMs", () => {
    expect(() =>
      botConfigSchema.parse({
        bot: {
          defaultModel: "codex-mini",
          maxTokens: 4096,
          timeoutMs: 30000,
        },
        server: { port: 3000 },
        github,
        workspace,
        develop: { codexModel: "codex-mini", timeoutMs: -1 },
      }),
    ).toThrow();
  });
});
