export type Phase =
  | "init"
  | "planned"
  | "developed"
  | "tested"
  | "committed"
  | "completed";

export type SubStage = "idle" | "running" | "done";

export interface ThreadState {
  initiatedBy: string;
  issueNumber: number;
  repo: string;
  branch: string;
  workspacePath: string;
  currentPhase: Phase;
  subStage: SubStage;
  lastError: string | null;
  planOutput: string | null;
}
