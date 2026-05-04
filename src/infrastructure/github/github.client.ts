import { ExternalServiceError, NotFoundError } from "@/shared/types/errors";
import { err, ok, type Result } from "@/shared/types/result";
import { execCommand } from "@/shared/utils/exec";
import { getLogger } from "@/shared/utils/logger";

const GH_TIMEOUT_MS = 30_000;

export interface IssueInfo {
  number: number;
  title: string;
  body: string | null;
  owner: string;
  repo: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreatePROptions {
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface CreatePRResult {
  url: string;
  number: number;
}

export class GitHubClient {
  async getIssue(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<Result<IssueInfo>> {
    const log = getLogger();

    try {
      const { stdout } = await execCommand(
        "gh",
        ["api", `repos/${owner}/${repo}/issues/${issueNumber}`],
        { timeout: GH_TIMEOUT_MS },
      );

      const data = JSON.parse(stdout);
      return ok({
        number: data.number,
        title: data.title,
        body: data.body ?? null,
        owner,
        repo,
        state: data.state,
        labels: data.labels.map((l: { name: string }) => l.name),
        assignees: data.assignees.map((a: { login: string }) => a.login),
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      });
    } catch (e) {
      if (GitHubClient.isNotFound(e)) {
        return err(new NotFoundError(`Issue ${owner}/${repo}#${issueNumber}`));
      }

      log.error(
        {
          err: e instanceof Error ? e.message : String(e),
          owner,
          repo,
          issueNumber,
        },
        "Failed to fetch issue via gh api",
      );
      return err(
        new ExternalServiceError(
          "GitHub",
          e instanceof Error ? e.message : String(e),
        ),
      );
    }
  }

  async createPullRequest(
    owner: string,
    repo: string,
    options: CreatePROptions,
  ): Promise<Result<CreatePRResult>> {
    const log = getLogger();

    try {
      const { stdout } = await execCommand(
        "gh",
        [
          "api",
          `repos/${owner}/${repo}/pulls`,
          "--method",
          "POST",
          "--field",
          `title=${options.title}`,
          "--field",
          `body=${options.body}`,
          "--field",
          `head=${options.head}`,
          "--field",
          `base=${options.base}`,
        ],
        { timeout: GH_TIMEOUT_MS },
      );

      const data = JSON.parse(stdout);
      return ok({ url: data.html_url, number: data.number });
    } catch (e) {
      log.error(
        {
          err: e instanceof Error ? e.message : String(e),
          owner,
          repo,
          head: options.head,
          base: options.base,
        },
        "Failed to create pull request via gh api",
      );
      return err(
        new ExternalServiceError(
          "GitHub",
          e instanceof Error ? e.message : String(e),
        ),
      );
    }
  }
  private static isNotFound(e: unknown): boolean {
    if (e && typeof e === "object" && "stderr" in e) {
      const stderr = (e as { stderr?: string }).stderr;
      if (!stderr) return false;

      try {
        const parsed = JSON.parse(stderr);
        return parsed.message === "Not Found";
      } catch {
        return stderr.includes("Not Found");
      }
    }
    return false;
  }
}
