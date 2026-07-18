import { matchesKey, ProcessTerminal, TUI } from "@earendil-works/pi-tui";
import type { AgentSendResult } from "@flue/sdk";

import { createConnection, type ConnectionOptions } from "../client.js";
import { createTranslator } from "../events.js";
import { createChatUi } from "../ui/app.js";
import type { ToolDisplayMode } from "../ui/tool-block.js";

interface ActiveTurn {
  controller: AbortController;
  interrupted: boolean;
}

interface ChatCommandOptions extends ConnectionOptions {
  tools: ToolDisplayMode;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runChatCommand(
  options: ChatCommandOptions,
): Promise<number> {
  const connection = createConnection(options);
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
    ui.addUserMessage(message);
    ui.setBusy(true);

    let admission: AgentSendResult | undefined;

    try {
      admission = await connection.send(message, {
        signal: turn.controller.signal,
      });
      const translator = createTranslator();
      await connection.wait(admission, {
        signal: turn.controller.signal,
        onEvent: (chunk) => {
          for (const event of translator.translate(chunk)) {
            ui.applyEvent(event);
          }
        },
      });
    } catch (error) {
      if (!turn.interrupted) {
        if (admission !== undefined) {
          ui.addNotice(
            `wait failed for agent "${options.agent}", instance id "${options.id}", ` +
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

  const handleSubmit = (input: string) => {
    const message = input.trim();
    if (message.length === 0 || activeTurn !== undefined) {
      return;
    }

    if (message.startsWith("/")) {
      const command = message.split(/\s/, 1)[0];
      if (command === "/exit") {
        finish(0);
      } else if (command === "/help") {
        ui.addNotice("commands: /help, /exit");
      } else {
        ui.addNotice(`unknown command: ${command}`);
      }
      return;
    }

    void sendMessage(message);
  };

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

      if (!matchesKey(data, "ctrl+c")) {
        return undefined;
      }

      if (activeTurn !== undefined) {
        if (!activeTurn.interrupted) {
          activeTurn.interrupted = true;
          activeTurn.controller.abort();
          ui.addNotice("interrupted — agent keeps running server-side");
        }
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
