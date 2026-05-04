import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebFetcherClient } from "@/infrastructure/web/web-fetcher.client";
import { ExternalServiceError } from "@/shared/types/errors";
import { err, ok } from "@/shared/types/result";
import type { ChatResult, OpenAIClient } from "../client/openai.client";
import { SummaryService } from "./summary.service";

vi.mock("@/shared/utils/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

function createMockOpenAIClient(response: string): OpenAIClient {
  const chatResult: ChatResult = {
    response,
    usage: null,
  };
  return {
    chat: vi.fn().mockResolvedValue(chatResult),
  } as unknown as OpenAIClient;
}

function createMockWebFetcher(results: Map<string, string>): WebFetcherClient {
  return {
    fetchContent: vi.fn((url: string) => {
      const text = results.get(url);
      return text
        ? Promise.resolve(ok(text))
        : Promise.resolve(
            err(new ExternalServiceError("WebFetch", "not found")),
          );
    }),
  } as unknown as WebFetcherClient;
}

describe("SummaryService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("URL一覧を渡して要約結果を返す", async () => {
    const client = createMockOpenAIClient("AI summary");
    const fetcher = createMockWebFetcher(
      new Map([["https://example.com", "page content"]]),
    );
    const service = new SummaryService(client, fetcher);

    const result = await service.summarize(["https://example.com"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("AI summary");
    }
  });

  it("fetches content before calling AI", async () => {
    const client = createMockOpenAIClient("response");
    const fetcher = createMockWebFetcher(
      new Map([["https://example.com", "fetched text"]]),
    );
    const service = new SummaryService(client, fetcher);

    await service.summarize(["https://example.com"]);
    expect(fetcher.fetchContent).toHaveBeenCalledWith("https://example.com");
    expect(client.chat).toHaveBeenCalledWith([
      { role: "user", content: expect.any(String) },
    ]);
  });

  it("全URL取得失敗時はerrを返す", async () => {
    const client = createMockOpenAIClient("response");
    const fetcher = createMockWebFetcher(new Map());
    const service = new SummaryService(client, fetcher);

    const result = await service.summarize(["https://example.com"]);
    expect(result.ok).toBe(false);
  });

  it("OpenAIエラー時はerrを返す", async () => {
    const client = {
      chat: vi.fn().mockRejectedValue(new Error("API error")),
    } as unknown as OpenAIClient;
    const fetcher = createMockWebFetcher(
      new Map([["https://example.com", "text"]]),
    );
    const service = new SummaryService(client, fetcher);

    const result = await service.summarize(["https://example.com"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("API error");
    }
  });
});
