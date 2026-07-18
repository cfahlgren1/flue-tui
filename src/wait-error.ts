import type { FlueConversationSettlement } from "@flue/sdk";

type TerminalSettlement = Pick<
  FlueConversationSettlement,
  "submissionId" | "outcome" | "error"
>;

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
    if ("details" in error && typeof error.details === "string") {
      return error.details;
    }
  }
  return String(error);
}

export function formatPostAdmissionWaitError(options: {
  agent: string;
  id: string;
  submissionId: string;
  settlement?: TerminalSettlement;
  error: unknown;
}): string {
  const { agent, id, submissionId, settlement, error } = options;
  const identity =
    `agent "${agent}", instance id "${id}", ` +
    `submissionId "${submissionId}"`;

  if (settlement?.outcome === "failed") {
    return `submission failed for ${identity}: ${errorMessage(settlement.error ?? error)}`;
  }
  if (settlement?.outcome === "aborted") {
    return settlement.error === undefined
      ? `submission aborted for ${identity}`
      : `submission aborted for ${identity}: ${errorMessage(settlement.error)}`;
  }

  return (
    `wait failed for ${identity}; the durable submission may still be running. ` +
    `Resume it with --id ${id}: ${errorMessage(error)}`
  );
}
