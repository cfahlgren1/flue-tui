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
import { ToolBlock, type ToolDisplayMode } from "./tool-block.js";

interface ChatUiOptions {
  tui: TUI;
  agent: string;
  url: string;
  id: string;
  tools: ToolDisplayMode;
}

interface ReadLoopOptions {
  onSubmit: (text: string, editor: Editor) => void;
  onInput: (
    data: string,
    editor: Editor,
  ) => { consume?: boolean; data?: string } | undefined;
}

export function createChatUi({ tui, agent, url, id, tools }: ChatUiOptions) {
  const chatContainer = new Container();
  const statusArea = new Container();
  const editor = new Editor(tui, theme.editor);
  const toolBlocks = new Map<string, ToolBlock>();
  let currentAssistant: AssistantMessageBlock | undefined;
  let receivedAssistantDelta = false;
  let toolsExpanded = tools === "full";
  let loader: Loader | undefined;

  tui.addChild(
    new Text(theme.header(`flue-tui · ${agent}@${url} · ${id}`), 1, 1),
  );
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
    receivedAssistantDelta = false;
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
        receivedAssistantDelta = true;
        (currentAssistant ?? addAssistant()).appendDelta(event.text);
        break;
      case "reasoning-delta":
        (currentAssistant ?? addAssistant()).appendReasoning(event.text);
        break;
      case "tool-start": {
        if (tools === "hidden") {
          break;
        }

        currentAssistant = undefined;
        const block = new ToolBlock(event, toolsExpanded);
        toolBlocks.set(event.toolCallId, block);
        chatContainer.addChild(block);
        break;
      }
      case "tool-end": {
        if (tools === "hidden") {
          break;
        }

        let block = toolBlocks.get(event.toolCallId);
        if (block === undefined) {
          currentAssistant = undefined;
          block = new ToolBlock(
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
            },
            toolsExpanded,
          );
          toolBlocks.set(event.toolCallId, block);
          chatContainer.addChild(block);
        }
        block.complete(event);
        break;
      }
      case "assistant-complete":
        if (!receivedAssistantDelta && event.text.length > 0) {
          (currentAssistant ?? addAssistant()).complete(event.text);
        }
        currentAssistant = undefined;
        receivedAssistantDelta = false;
        break;
      case "reasoning-complete":
        break;
      case "reset":
        chatContainer.clear();
        toolBlocks.clear();
        currentAssistant = undefined;
        receivedAssistantDelta = false;
        break;
      case "settled":
        currentAssistant = undefined;
        receivedAssistantDelta = false;
        setBusy(false);
        return;
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }

    requestRender();
  };

  const toggleToolsExpanded = () => {
    if (tools === "hidden") {
      return;
    }

    toolsExpanded = !toolsExpanded;
    for (const block of toolBlocks.values()) {
      block.setExpanded(toolsExpanded);
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

  return {
    applyEvent,
    addUserMessage,
    addNotice,
    setBusy,
    toggleToolsExpanded,
    readLoop,
  };
}
