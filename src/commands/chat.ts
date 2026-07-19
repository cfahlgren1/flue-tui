import { setTimeout as delay } from "node:timers/promises";

import {
  isKeyRelease,
  matchesKey,
  ProcessTerminal,
  TUI,
} from "@earendil-works/pi-tui";
import {
  DurableStreamError,
  FetchBackoffAbortError,
  FetchError,
} from "@flue/sdk";
import type {
  AgentSendResult,
  ConversationStreamChunk,
  FlueConversationMessage,
} from "@flue/sdk";

import { generateId } from "../args.js";
import {
  createConnection,
  type ConnectionOptions,
  type FlueConnection,
} from "../client.js";
import { createChatUi, type ChatUi } from "../ui/app.js";
import { helpLines, isToolDisplayMode } from "../ui/commands.js";
import type { ToolDisplayMode } from "../ui/tool-block.js";
import { errorMessage, formatPostAdmissionWaitError } from "../wait-error.js";
import { createChatSession, type ChatSession } from "./chat-session.js";

interface LocalWait {
  controller: AbortController;
  interrupted: boolean;
  submissionId?: string;
}

const noop = () => undefined;

export interface ChatCommandOptions extends ConnectionOptions {
  tools: ToolDisplayMode;
  resume: boolean;
}

interface ChatControllerOptions<TBlock> {
  options: ChatCommandOptions;
  connection: FlueConnection;
  connectionFactory: (options: ConnectionOptions) => FlueConnection;
  ui: ChatUi<TBlock>;
  recoveryDelay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export interface ChatCommandDependencies<TBlock> {
  connectionFactory?: (options: ConnectionOptions) => FlueConnection;
  uiFactory: (options: ChatCommandOptions) => ChatUi<TBlock>;
}

function isCompletedAssistantMessage(
  message: FlueConversationMessage,
): boolean {
  return (
    message.role === "assistant" &&
    message.parts.every((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        return part.state === "done";
      }
      if (part.type === "dynamic-tool") {
        return part.state !== "input-available";
      }
      return true;
    })
  );
}

function isTransportWaitError(error: unknown): boolean {
  return (
    error instanceof DurableStreamError ||
    error instanceof FetchBackoffAbortError ||
    error instanceof FetchError ||
    error instanceof TypeError
  );
}

export function shouldIgnoreChatInput(data: string): boolean {
  return isKeyRelease(data);
}

export function createChatController<TBlock>({
  options,
  connection: initialConnection,
  connectionFactory,
  ui,
  recoveryDelay = async (milliseconds, signal) => {
    await delay(milliseconds, undefined, { signal });
  },
}: ChatControllerOptions<TBlock>) {
  let session: ChatSession = createChatSession({
    id: options.id,
    url: options.url,
    connection: initialConnection,
    ui,
  });
  let localWait: LocalWait | undefined;
  let removeInputListener: () => void = noop;
  let finish!: (code: number) => void;

  const done = new Promise<number>((resolve) => {
    finish = (code) => {
      removeInputListener();
      session.closeObservation();
      ui.setBusy(false);
      ui.stop();
      resolve(code);
    };
  });

  const recoverSubmission = async (
    wait: LocalWait,
    waitSession: ChatSession,
    submissionId: string,
  ) => {
    try {
      await recoveryDelay(2_000, wait.controller.signal);
    } catch {
      return;
    }

    if (wait.interrupted || session !== waitSession) {
      return;
    }

    try {
      const snapshot = await waitSession.connection.history({
        signal: wait.controller.signal,
      });
      const completedSettlement = snapshot.settlements.some(
        (value) =>
          value.submissionId === submissionId && value.outcome === "completed",
      );
      const recoveredMessage = snapshot.messages.findLast(
        (message) =>
          message.submissionId === submissionId &&
          isCompletedAssistantMessage(message),
      );

      if (!completedSettlement || recoveredMessage === undefined) {
        return;
      }

      const result = waitSession.reconcile(snapshot);
      if (!result.changedMessageIds.has(recoveredMessage.id)) {
        return;
      }

      waitSession.closeObservation();
      if (recoveredMessage.metadata?.usage !== undefined) {
        ui.recordUsage(recoveredMessage.metadata.usage);
      }
      ui.addRecoveredMarker();
      waitSession.openObservation(false);
    } catch (error) {
      if (!wait.interrupted && session === waitSession) {
        ui.addNotice(`recovery refresh failed: ${errorMessage(error)}`);
      }
    }
  };

  const sendMessage = async (message: string) => {
    const wait: LocalWait = {
      controller: new AbortController(),
      interrupted: false,
    };
    localWait = wait;
    const waitSession = session;
    ui.setBusy(true);

    let admission: AgentSendResult | undefined;
    let settlement:
      | Extract<ConversationStreamChunk, { type: "submission-settled" }>
      | undefined;

    try {
      admission = await waitSession.connection.send(message, {
        signal: wait.controller.signal,
      });
      wait.submissionId = admission.submissionId;
      if (waitSession.observation !== undefined) {
        const phase = waitSession.observation.getSnapshot().phase;
        if (phase === "absent" || phase === "loading") {
          waitSession.observation.refresh();
        }
      }
      const result = await waitSession.connection.wait(admission, {
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
      ui.recordUsage(result.usage);
    } catch (error) {
      if (!wait.interrupted) {
        if (admission !== undefined) {
          const observedSettlement = waitSession.observation
            ?.getSnapshot()
            .conversation?.settlements.find(
              (value) => value.submissionId === admission?.submissionId,
            );
          ui.addNotice(
            formatPostAdmissionWaitError({
              agent: options.agent,
              id: waitSession.id,
              submissionId: admission.submissionId,
              settlement: settlement ?? observedSettlement,
              error,
            }),
          );
          if (isTransportWaitError(error)) {
            await recoverSubmission(wait, waitSession, admission.submissionId);
          }
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
      ui.addNotice(
        localWait.submissionId === undefined
          ? "interrupted before server admission could be confirmed"
          : "interrupted — agent keeps running server-side",
      );
    }
  };

  const startNewSession = () => {
    const previousSession = session;
    if (localWait !== undefined) {
      cancelLocalWait(false);
      localWait = undefined;
      ui.setBusy(false);
    }

    previousSession.closeObservation();
    const nextId = generateId();
    session = createChatSession({
      id: nextId,
      url: options.url,
      connection: connectionFactory({ ...options, id: nextId }),
      ui,
    });
    ui.clearTranscript();
    ui.resetUsage();
    ui.setId(session.id);
    session.openObservation(false);
    ui.addNotice(
      `new session ${session.id} — previous session ${previousSession.id} keeps running server-side; ` +
        `resume it with --id ${previousSession.id}`,
    );
  };

  const abortSession = async () => {
    const abortedSession = session;
    cancelLocalWait(false);

    try {
      const result = await abortedSession.connection.abort();
      if (session !== abortedSession) {
        return;
      }
      ui.addNotice(
        result.aborted
          ? `remote abort requested for session ${abortedSession.id}`
          : `session ${abortedSession.id} had no running or queued work to abort`,
      );
    } catch (error) {
      if (session === abortedSession) {
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
      const [command, ...commandArgs] = message.split(/\s+/);
      if (command === "/exit") {
        cancelLocalWait(false);
        finish(0);
      } else if (command === "/help") {
        for (const line of helpLines()) {
          ui.addNotice(line);
        }
      } else if (command === "/id") {
        ui.addNotice(`agent ${options.agent}, session ${session.id}`);
      } else if (command === "/new") {
        startNewSession();
      } else if (command === "/abort") {
        void abortSession();
      } else if (command === "/tools") {
        const mode = commandArgs[0];
        if (mode === undefined || !isToolDisplayMode(mode)) {
          ui.addNotice("usage: /tools <collapsed|full|hidden>");
        } else {
          ui.setToolsMode(mode);
          ui.addNotice(`tool display mode: ${mode}`);
        }
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

  session.openObservation(options.resume);

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
        ui.requestRender();
      } else {
        finish(0);
      }

      return { consume: true };
    },
  });

  return { run: () => done };
}

export function runChatCommand(options: ChatCommandOptions): Promise<number>;
export function runChatCommand<TBlock>(
  options: ChatCommandOptions,
  dependencies: ChatCommandDependencies<TBlock>,
): Promise<number>;
export async function runChatCommand<TBlock>(
  options: ChatCommandOptions,
  dependencies?: ChatCommandDependencies<TBlock>,
): Promise<number> {
  if (dependencies !== undefined) {
    const connectionFactory =
      dependencies.connectionFactory ?? createConnection;
    return createChatController({
      options,
      connection: connectionFactory(options),
      connectionFactory,
      ui: dependencies.uiFactory(options),
    }).run();
  }

  const tui = new TUI(new ProcessTerminal());
  const ui = createChatUi({ tui, ...options });
  return createChatController({
    options,
    connection: createConnection(options),
    connectionFactory: createConnection,
    ui,
  }).run();
}
