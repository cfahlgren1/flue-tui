import {
  Container,
  Editor,
  Loader,
  Text,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

import {
  AssistantMessageBlock,
  NoticeBlock,
  ReasoningBlock,
  UserMessageBlock,
} from "./blocks.js";
import type { ReconcileUi } from "./reconcile.js";
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
  const header = new Text(
    theme.header(`flue-tui · ${agent}@${url} · ${id}`),
    1,
    1,
  );
  const toolBlocks = new Map<string, ToolBlock>();
  let toolsExpanded = tools === "full";
  let loader: Loader | undefined;

  tui.addChild(header);
  tui.addChild(chatContainer);
  tui.addChild(statusArea);
  tui.addChild(editor);
  tui.setFocus(editor);

  const requestRender = () => tui.requestRender();

  const addNotice = (text: string) => {
    chatContainer.addChild(new NoticeBlock(text));
    requestRender();
  };

  const setId = (nextId: string) => {
    header.setText(theme.header(`flue-tui · ${agent}@${url} · ${nextId}`));
    requestRender();
  };

  const clearTranscript = () => {
    chatContainer.clear();
    toolBlocks.clear();
    requestRender();
  };

  const setBusy = (busy: boolean) => {
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

  const registerToolBlock = (block: Component) => {
    if (block instanceof ToolBlock) {
      toolBlocks.set(block.toolCallId, block);
    }
  };

  const reconcileUi: ReconcileUi<Component> = {
    createTextBlock(role, part) {
      const block =
        role === "user"
          ? new UserMessageBlock(part.text)
          : new AssistantMessageBlock(part.text);
      return {
        block,
        update(nextPart) {
          block.setText(nextPart.text);
        },
      };
    },
    createReasoningBlock(part) {
      const block = new ReasoningBlock(part.text);
      return {
        block,
        update(nextPart) {
          block.setText(nextPart.text);
        },
      };
    },
    createToolBlock(part) {
      if (tools === "hidden") {
        return { update: () => undefined };
      }
      const block = new ToolBlock(part, toolsExpanded);
      return {
        block,
        update(nextPart) {
          block.update(nextPart);
        },
      };
    },
    appendTranscriptBlock(block) {
      registerToolBlock(block);
      chatContainer.addChild(block);
    },
    replaceTranscript(blocks) {
      chatContainer.clear();
      toolBlocks.clear();
      for (const block of blocks) {
        registerToolBlock(block);
        chatContainer.addChild(block);
      }
    },
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
    reconcileUi,
    requestRender,
    addNotice,
    setId,
    clearTranscript,
    setBusy,
    toggleToolsExpanded,
    readLoop,
  };
}
