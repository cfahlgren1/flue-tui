import type {
  AgentConversationObservation,
  FlueConversationSnapshot,
  FlueConversationState,
} from "@flue/sdk";

import type { FlueConnection } from "../client.js";
import type { ChatUi } from "../ui/app.js";
import { createReconciler, type ReconcileResult } from "../ui/reconcile.js";
import { errorMessage } from "../wait-error.js";

type Conversation = FlueConversationSnapshot | FlueConversationState;
const noop = () => undefined;

interface ChatSessionOptions<TBlock> {
  id: string;
  url: string;
  connection: FlueConnection;
  ui: ChatUi<TBlock>;
}

export interface ChatSession {
  readonly id: string;
  readonly connection: FlueConnection;
  readonly observation: AgentConversationObservation | undefined;
  closeObservation(): void;
  openObservation(showResumeNotice: boolean): void;
  reconcile(conversation: Conversation): ReconcileResult;
}

export function createChatSession<TBlock>({
  id,
  url,
  connection,
  ui,
}: ChatSessionOptions<TBlock>): ChatSession {
  const reconciler = createReconciler(ui.reconcileUi);
  let observation: AgentConversationObservation | undefined;
  let removeObservationListener: () => void = noop;
  let reachedServer = false;
  let reconnecting = false;
  let reachabilityNoticeTimer: ReturnType<typeof setTimeout> | undefined;

  const clearReachabilityNoticeTimer = () => {
    if (reachabilityNoticeTimer === undefined) {
      return;
    }

    clearTimeout(reachabilityNoticeTimer);
    reachabilityNoticeTimer = undefined;
  };

  const closeObservation = () => {
    clearReachabilityNoticeTimer();
    if (reconnecting) {
      reconnecting = false;
      ui.setReconnecting(false);
    }
    removeObservationListener();
    removeObservationListener = noop;
    observation?.close();
    observation = undefined;
  };

  const openObservation = (showResumeNotice: boolean) => {
    const nextObservation = connection.observe({ live: "sse" });
    let resumeNoticePending = showResumeNotice;
    let reportedError: Error | undefined;
    observation = nextObservation;
    removeObservationListener = nextObservation.subscribe(() => {
      if (observation !== nextObservation) {
        return;
      }

      const snapshot = nextObservation.getSnapshot();
      if (snapshot.conversation !== undefined) {
        reachedServer = true;
        reconciler.reconcile(snapshot.conversation);
        ui.requestRender();
        if (resumeNoticePending) {
          resumeNoticePending = false;
          ui.addNotice(
            `resumed session ${id} (${snapshot.conversation.messages.length} messages)`,
          );
        }
      } else if (snapshot.phase === "absent") {
        reachedServer = true;
        resumeNoticePending = false;
      }

      if (snapshot.phase === "connecting" && snapshot.error !== undefined) {
        if (!reconnecting) {
          reconnecting = true;
          ui.setReconnecting(true);
          if (reachedServer) {
            ui.addNotice("connection lost — retrying");
          } else {
            reachabilityNoticeTimer = setTimeout(() => {
              reachabilityNoticeTimer = undefined;
              const latest = nextObservation.getSnapshot();
              if (
                observation === nextObservation &&
                reconnecting &&
                !reachedServer &&
                latest.phase === "connecting" &&
                latest.error !== undefined
              ) {
                ui.addNotice(`cannot reach ${new URL(url).origin} — retrying`);
              }
            }, 2_000);
          }
        }
      } else if (snapshot.phase === "live" || snapshot.phase === "absent") {
        reachedServer = true;
        clearReachabilityNoticeTimer();
        if (reconnecting) {
          reconnecting = false;
          ui.setReconnecting(false);
        }
      }

      if (
        snapshot.phase === "error" &&
        snapshot.error !== undefined &&
        snapshot.error !== reportedError
      ) {
        reportedError = snapshot.error;
        ui.addNotice(`observation failed: ${errorMessage(snapshot.error)}`);
      }
    });
  };

  return {
    id,
    connection,
    get observation() {
      return observation;
    },
    closeObservation,
    openObservation,
    reconcile: reconciler.reconcile,
  };
}
