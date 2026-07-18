import {
  Container,
  Editor,
  Loader,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";

import type { TuiEvent } from "../events.js";
import {
  AssistantMessageBlock,
  NoticeBlock,
  UserMessageBlock,
} from "./blocks.js";
import { theme } from "./theme.js";

interface ChatUiOptions {
  tui: TUI;
  agent: string;
  url: string;
  id: string;
}

interface ReadLoopOptions {
  onSubmit: (text: string, editor: Editor) => void;
  onInput: (
    data: string,
    editor: Editor,
  ) => { consume?: boolean; data?: string } | undefined;
}

export function createChatUi({ tui, agent, url, id }: ChatUiOptions) {
  const chatContainer = new Container();
  const statusArea = new Container();
  const editor = new Editor(tui, theme.editor);
  let currentAssistant: AssistantMessageBlock | undefined;
  let loader: Loader | undefined;

  tui.addChild(new Text(theme.header(`flue-tui · ${agent}@${url} · ${id}`), 1, 1));
  tui.addChild(chatContainer);
  tui.addChild(statusArea);
  tui.addChild(editor);
  tui.setFocus(editor);

  const requestRender = () => tui.requestRender();

  const addAssistant = () => {
    const block = new AssistantMessageBlock();
    chatContainer.addChild(block);
    currentAssistant = block;
    return block;
  };

  const addUserMessage = (text: string) => {
    currentAssistant = undefined;
    chatContainer.addChild(new UserMessageBlock(text));
    requestRender();
  };

  const addNotice = (text: string) => {
    chatContainer.addChild(new NoticeBlock(text));
    requestRender();
  };

  const setBusy = (busy: boolean) => {
    editor.disableSubmit = busy;

    if (busy && loader === undefined) {
      loader = new Loader(
        tui,
        theme.loader.spinner,
        theme.loader.message,
        "waiting for agent…",
      );
      statusArea.addChild(loader);
    } else if (!busy && loader !== undefined) {
      loader.stop();
      statusArea.removeChild(loader);
      loader = undefined;
    }

    requestRender();
  };

  const applyEvent = (event: TuiEvent) => {
    switch (event.type) {
      case "user-message":
        addUserMessage(event.text);
        return;
      case "assistant-delta":
        (currentAssistant ?? addAssistant()).appendDelta(event.text);
        break;
      case "reasoning-delta":
        (currentAssistant ?? addAssistant()).appendReasoning(event.text);
        break;
      case "tool-start":
        (currentAssistant ?? addAssistant()).addToolLine(`tool ${event.toolName}`);
        break;
      case "tool-end": {
        const status = event.ok ? "done" : "error";
        (currentAssistant ?? addAssistant()).addToolLine(
          `tool ${status} ${event.toolName} (${event.durationMs}ms)`,
        );
        break;
      }
      case "assistant-complete":
        (currentAssistant ?? addAssistant()).complete(event.text);
        currentAssistant = undefined;
        break;
      case "reasoning-complete":
        break;
      case "reset":
        chatContainer.clear();
        currentAssistant = undefined;
        break;
      case "settled":
        currentAssistant = undefined;
        setBusy(false);
        return;
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }

    requestRender();
  };

  const readLoop = ({ onSubmit, onInput }: ReadLoopOptions) => {
    editor.onSubmit = (text) => onSubmit(text, editor);
    const removeInputListener = tui.addInputListener((data) =>
      onInput(data, editor),
    );
    tui.start();
    return removeInputListener;
  };

  return { applyEvent, addUserMessage, addNotice, setBusy, readLoop };
}
