import {
  isKeyRelease,
  matchesKey,
  ProcessTerminal,
  TUI,
} from "@earendil-works/pi-tui";
import type {
  AgentConversationObservation,
  AgentSendResult,
  ConversationStreamChunk,
} from "@flue/sdk";

import { generateId } from "../args.js";
import { createConnection, type ConnectionOptions } from "../client.js";
import { createChatUi } from "../ui/app.js";
import { createReconciler } from "../ui/reconcile.js";
import type { ToolDisplayMode } from "../ui/tool-block.js";
import {
  errorMessage,
  formatPostAdmissionWaitError,
} from "../wait-error.js";

interface LocalWait {
  controller: AbortController;
  interrupted: boolean;
  submissionId?: string;
}

interface ChatCommandOptions extends ConnectionOptions {
  tools: ToolDisplayMode;
  resume: boolean;
}

export function shouldIgnoreChatInput(data: string): boolean {
  return isKeyRelease(data);
}

export async function runChatCommand(
  options: ChatCommandOptions,
): Promise<number> {
  let currentId = options.id;
  let connection = createConnection(options);
  const tui = new TUI(new ProcessTerminal());
  const ui = createChatUi({ tui, ...options });
  let localWait: LocalWait | undefined;
  let observation: AgentConversationObservation | undefined;
  let removeObservationListener: () => void = () => undefined;
  let removeInputListener: () => void = () => undefined;
  let finish!: (code: number) => void;
  let reconciler = createReconciler(ui.reconcileUi);

  const closeObservation = () => {
    removeObservationListener();
    removeObservationListener = () => undefined;
    observation?.close();
    observation = undefined;
  };

  const done = new Promise<number>((resolve) => {
    finish = (code) => {
      removeInputListener();
      closeObservation();
      ui.setBusy(false);
      tui.stop();
      resolve(code);
    };
  });

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
        reconciler.reconcile(snapshot.conversation);
        ui.requestRender();
        if (resumeNoticePending) {
          resumeNoticePending = false;
          ui.addNotice(
            `resumed session ${currentId} (${snapshot.conversation.messages.length} messages)`,
          );
        }
      } else if (snapshot.phase === "absent") {
        resumeNoticePending = false;
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

  const sendMessage = async (message: string) => {
    const wait: LocalWait = {
      controller: new AbortController(),
      interrupted: false,
    };
    localWait = wait;
    const waitConnection = connection;
    const waitId = currentId;
    ui.setBusy(true);

    let admission: AgentSendResult | undefined;
    let settlement:
      | Extract<ConversationStreamChunk, { type: "submission-settled" }>
      | undefined;

    try {
      admission = await waitConnection.send(message, {
        signal: wait.controller.signal,
      });
      wait.submissionId = admission.submissionId;
      if (observation !== undefined) {
        const phase = observation.getSnapshot().phase;
        if (phase === "absent" || phase === "loading") {
          observation.refresh();
        }
      }
      await waitConnection.wait(admission, {
        signal: wait.controller.signal,
        onEvent: (event) => {
          if (
            event.type === "submission-settled" &&
            event.submissionId === wait.submissionId
          ) {
            settlement = event;
          }
        },
      });
    } catch (error) {
      if (!wait.interrupted) {
        if (admission !== undefined) {
          const observedSettlement = observation
            ?.getSnapshot()
            .conversation?.settlements.find(
              (value) => value.submissionId === admission?.submissionId,
            );
          ui.addNotice(
            formatPostAdmissionWaitError({
              agent: options.agent,
              id: waitId,
              submissionId: admission.submissionId,
              settlement: settlement ?? observedSettlement,
              error,
            }),
          );
        } else {
          ui.addNotice(`error: ${errorMessage(error)}`);
        }
      }
    } finally {
      if (localWait === wait) {
        localWait = undefined;
        ui.setBusy(false);
      }
    }
  };

  const cancelLocalWait = (showNotice = true) => {
    if (localWait === undefined || localWait.interrupted) {
      return;
    }

    localWait.interrupted = true;
    localWait.controller.abort();
    if (showNotice) {
      ui.addNotice("interrupted — agent keeps running server-side");
    }
  };

  const startNewSession = () => {
    const previousId = currentId;
    if (localWait !== undefined) {
      cancelLocalWait(false);
      localWait = undefined;
      ui.setBusy(false);
    }

    closeObservation();
    currentId = generateId();
    connection = createConnection({ ...options, id: currentId });
    reconciler = createReconciler(ui.reconcileUi);
    ui.clearTranscript();
    ui.setId(currentId);
    openObservation(false);
    ui.addNotice(
      `new session ${currentId} — previous session ${previousId} keeps running server-side; ` +
        `resume it with --id ${previousId}`,
    );
  };

  const abortSession = async () => {
    const abortedId = currentId;
    const abortedConnection = connection;
    cancelLocalWait(false);

    try {
      const result = await abortedConnection.abort();
      if (currentId !== abortedId) {
        return;
      }
      ui.addNotice(
        result.aborted
          ? `remote abort requested for session ${abortedId}`
          : `session ${abortedId} had no running or queued work to abort`,
      );
    } catch (error) {
      if (currentId === abortedId) {
        ui.addNotice(`abort failed: ${errorMessage(error)}`);
      }
    }
  };

  const handleSubmit = (input: string) => {
    const message = input.trim();
    if (message.length === 0) {
      return;
    }

    if (message.startsWith("/")) {
      const command = message.split(/\s/, 1)[0];
      if (command === "/exit") {
        cancelLocalWait(false);
        finish(0);
      } else if (command === "/help") {
        ui.addNotice("commands: /help, /id, /new, /abort, /exit");
      } else if (command === "/id") {
        ui.addNotice(`agent ${options.agent}, session ${currentId}`);
      } else if (command === "/new") {
        startNewSession();
      } else if (command === "/abort") {
        void abortSession();
      } else {
        ui.addNotice(`unknown command: ${command}`);
      }
      return;
    }

    if (localWait !== undefined) {
      return;
    }

    void sendMessage(message);
  };

  openObservation(options.resume);

  removeInputListener = ui.readLoop({
    onSubmit: (message, editor) => {
      const trimmed = message.trim();
      if (trimmed.length > 0 && !trimmed.startsWith("/")) {
        editor.addToHistory(trimmed);
      }
      handleSubmit(message);
    },
    onInput: (data, editor) => {
      if (shouldIgnoreChatInput(data)) {
        return undefined;
      }

      if (matchesKey(data, "ctrl+t")) {
        ui.toggleToolsExpanded();
        return { consume: true };
      }

      if (matchesKey(data, "escape") && localWait !== undefined) {
        cancelLocalWait();
        return { consume: true };
      }

      if (
        matchesKey(data, "enter") &&
        localWait !== undefined &&
        !editor.getText().trim().startsWith("/")
      ) {
        return { consume: true };
      }

      if (!matchesKey(data, "ctrl+c")) {
        return undefined;
      }

      if (localWait !== undefined) {
        cancelLocalWait();
      } else if (editor.getText().length > 0) {
        editor.setText("");
        tui.requestRender();
      } else {
        finish(0);
      }

      return { consume: true };
    },
  });

  return done;
}
