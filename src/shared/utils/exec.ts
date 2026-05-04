import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export async function execCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<ExecResult> {
  return (await execFileAsync(command, args, {
    cwd: options?.cwd,
    timeout: options?.timeout,
    encoding: "utf-8",
  })) as ExecResult;
}
