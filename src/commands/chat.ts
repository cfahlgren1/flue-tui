import { matchesKey, ProcessTerminal, TUI } from "@earendil-works/pi-tui";
import type { AgentSendResult } from "@flue/sdk";

import { generateId } from "../args.js";
import { createConnection, type ConnectionOptions } from "../client.js";
import { createTranslator, hydrateFromSnapshot } from "../events.js";
import { createChatUi } from "../ui/app.js";
import type { ToolDisplayMode } from "../ui/tool-block.js";

interface ActiveTurn {
  controller: AbortController;
  interrupted: boolean;
}

interface ChatCommandOptions extends ConnectionOptions {
  tools: ToolDisplayMode;
  resume: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  );
}

export async function runChatCommand(
  options: ChatCommandOptions,
): Promise<number> {
  let currentId = options.id;
  let connection = createConnection(options);
  const tui = new TUI(new ProcessTerminal());
  const ui = createChatUi({ tui, ...options });
  let activeTurn: ActiveTurn | undefined;
  let removeInputListener: () => void = () => undefined;
  let finish: (code: number) => void;

  const done = new Promise<number>((resolve) => {
    finish = (code) => {
      removeInputListener();
      ui.setBusy(false);
      tui.stop();
      resolve(code);
    };
  });

  const sendMessage = async (message: string) => {
    const turn: ActiveTurn = {
      controller: new AbortController(),
      interrupted: false,
    };
    activeTurn = turn;
    const turnConnection = connection;
    const turnId = currentId;
    ui.addUserMessage(message);
    ui.setBusy(true);

    let admission: AgentSendResult | undefined;

    try {
      admission = await turnConnection.send(message, {
        signal: turn.controller.signal,
      });
      const translator = createTranslator();
      await turnConnection.wait(admission, {
        signal: turn.controller.signal,
        onEvent: (chunk) => {
          if (activeTurn !== turn) {
            return;
          }
          for (const event of translator.translate(chunk)) {
            ui.applyEvent(event);
          }
        },
      });
    } catch (error) {
      if (!turn.interrupted) {
        if (admission !== undefined) {
          ui.addNotice(
            `wait failed for agent "${options.agent}", instance id "${turnId}", ` +
              `submissionId "${admission.submissionId}"; the durable submission may ` +
              `still be running and can be observed by re-running against the same ` +
              `instance id: ${errorMessage(error)}`,
          );
        } else {
          ui.addNotice(`error: ${errorMessage(error)}`);
        }
      }
    } finally {
      if (activeTurn === turn) {
        activeTurn = undefined;
        ui.setBusy(false);
      }
    }
  };

  const interruptActiveTurn = (showNotice = true) => {
    if (activeTurn === undefined || activeTurn.interrupted) {
      return;
    }

    activeTurn.interrupted = true;
    activeTurn.controller.abort();
    if (showNotice) {
      ui.addNotice("interrupted — agent keeps running server-side");
    }
  };

  const startNewSession = () => {
    if (activeTurn !== undefined) {
      interruptActiveTurn(false);
      activeTurn = undefined;
      ui.setBusy(false);
    }

    currentId = generateId();
    connection = createConnection({ ...options, id: currentId });
    ui.clearTranscript();
    ui.setId(currentId);
    ui.addNotice(`new session ${currentId}`);
  };

  const abortSession = async () => {
    const abortedId = currentId;
    const abortedConnection = connection;
    interruptActiveTurn(false);

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
        interruptActiveTurn(false);
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

    if (activeTurn !== undefined) {
      return;
    }

    void sendMessage(message);
  };

  if (options.resume) {
    try {
      const snapshot = await connection.history();
      if (snapshot.messages.length > 0) {
        for (const event of hydrateFromSnapshot(snapshot)) {
          ui.applyEvent(event);
        }
        ui.addNotice(
          `resumed session ${currentId} (${snapshot.messages.length} messages)`,
        );
      }
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }

  removeInputListener = ui.readLoop({
    onSubmit: (message, editor) => {
      const trimmed = message.trim();
      if (trimmed.length > 0 && !trimmed.startsWith("/")) {
        editor.addToHistory(trimmed);
      }
      handleSubmit(message);
    },
    onInput: (data, editor) => {
      if (matchesKey(data, "ctrl+t")) {
        ui.toggleToolsExpanded();
        return { consume: true };
      }

      if (matchesKey(data, "escape") && activeTurn !== undefined) {
        interruptActiveTurn();
        return { consume: true };
      }

      if (
        matchesKey(data, "enter") &&
        activeTurn !== undefined &&
        !editor.getText().trim().startsWith("/")
      ) {
        return { consume: true };
      }

      if (!matchesKey(data, "ctrl+c")) {
        return undefined;
      }

      if (activeTurn !== undefined) {
        interruptActiveTurn();
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
