import { existsSync } from "node:fs";
import { join } from "node:path";
import { ExternalServiceError } from "@/shared/types/errors";
import { err, ok, type Result } from "@/shared/types/result";
import { execCommand } from "@/shared/utils/exec";
import { getLogger } from "@/shared/utils/logger";

const GIT_TIMEOUT_MS = 60_000;

export class WorkspaceManager {
  constructor(private readonly workspaceRoot: string) {}

  async ensureClone(repoUrl: string, targetDir: string): Promise<Result<void>> {
    const log = getLogger();
    const fullPath = join(this.workspaceRoot, targetDir);

    if (existsSync(fullPath)) {
      log.debug({ targetDir: fullPath }, "Repository already cloned, skipping");
      return ok(undefined);
    }

    try {
      await execCommand("git", ["clone", repoUrl, fullPath], {
        timeout: GIT_TIMEOUT_MS,
      });
      log.info({ repoUrl, targetDir: fullPath }, "Repository cloned");
      return ok(undefined);
    } catch (e) {
      log.error(
        {
          err: e instanceof Error ? e.message : String(e),
          repoUrl,
          targetDir: fullPath,
        },
        "Failed to clone repository",
      );
      return err(
        new ExternalServiceError(
          "Git",
          e instanceof Error ? e.message : String(e),
        ),
      );
    }
  }

  async syncMain(targetDir: string): Promise<Result<void>> {
    const log = getLogger();
    const fullPath = join(this.workspaceRoot, targetDir);

    try {
      await execCommand("git", ["checkout", "main"], {
        cwd: fullPath,
        timeout: GIT_TIMEOUT_MS,
      });
      await execCommand("git", ["pull"], {
        cwd: fullPath,
        timeout: GIT_TIMEOUT_MS,
      });
      log.info({ targetDir: fullPath }, "Synced main branch");
      return ok(undefined);
    } catch (e) {
      log.error(
        {
          err: e instanceof Error ? e.message : String(e),
          targetDir: fullPath,
        },
        "Failed to sync main branch",
      );
      return err(
        new ExternalServiceError(
          "Git",
          e instanceof Error ? e.message : String(e),
        ),
      );
    }
  }

  async createBranch(
    targetDir: string,
    branchName: string,
  ): Promise<Result<void>> {
    const log = getLogger();
    const fullPath = join(this.workspaceRoot, targetDir);

    try {
      await execCommand("git", ["checkout", "-b", branchName], {
        cwd: fullPath,
        timeout: GIT_TIMEOUT_MS,
      });
      log.info({ targetDir: fullPath, branchName }, "Created feature branch");
      return ok(undefined);
    } catch (e) {
      log.error(
        {
          err: e instanceof Error ? e.message : String(e),
          targetDir: fullPath,
          branchName,
        },
        "Failed to create branch",
      );
      return err(
        new ExternalServiceError(
          "Git",
          e instanceof Error ? e.message : String(e),
        ),
      );
    }
  }

  async getDiff(targetDir: string): Promise<Result<string>> {
    const log = getLogger();
    const fullPath = join(this.workspaceRoot, targetDir);

    try {
      const { stdout } = await execCommand("git", ["diff"], {
        cwd: fullPath,
        timeout: GIT_TIMEOUT_MS,
      });
      return ok(stdout);
    } catch (e) {
      log.error(
        {
          err: e instanceof Error ? e.message : String(e),
          targetDir: fullPath,
        },
        "Failed to get diff",
      );
      return err(
        new ExternalServiceError(
          "Git",
          e instanceof Error ? e.message : String(e),
        ),
      );
    }
  }

  async discardChanges(targetDir: string): Promise<Result<void>> {
    const log = getLogger();
    const fullPath = join(this.workspaceRoot, targetDir);

    try {
      await execCommand("git", ["checkout", "--", "."], {
        cwd: fullPath,
        timeout: GIT_TIMEOUT_MS,
      });
      log.info({ targetDir: fullPath }, "Discarded working directory changes");
      return ok(undefined);
    } catch (e) {
      log.error(
        {
          err: e instanceof Error ? e.message : String(e),
          targetDir: fullPath,
        },
        "Failed to discard changes",
      );
      return err(
        new ExternalServiceError(
          "Git",
          e instanceof Error ? e.message : String(e),
        ),
      );
    }
  }
}
