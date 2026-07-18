import {
  Container,
  Editor,
  Loader,
  Text,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import type { PromptUsage } from "@flue/sdk";

import {
  AssistantMessageBlock,
  NoticeBlock,
  ReasoningBlock,
  UserMessageBlock,
} from "./blocks.js";
import { createChatAutocompleteProvider } from "./commands.js";
import { emptyUsageTotals, StatusFooter } from "./footer.js";
import type { ReconcileUi } from "./reconcile.js";
import { theme } from "./theme.js";
import { ToolBlock, type ToolDisplayMode } from "./tool-block.js";

export interface ChatUiOptions {
  tui: TUI;
  agent: string;
  url: string;
  id: string;
  tools: ToolDisplayMode;
}

export interface ChatEditor {
  addToHistory(text: string): void;
  getText(): string;
  setText(text: string): void;
}

export interface ReadLoopOptions {
  onSubmit: (text: string, editor: ChatEditor) => void;
  onInput: (
    data: string,
    editor: ChatEditor,
  ) => { consume?: boolean; data?: string } | undefined;
}

export interface ChatUi<TBlock> {
  reconcileUi: ReconcileUi<TBlock>;
  requestRender(): void;
  addNotice(text: string): void;
  setId(id: string): void;
  clearTranscript(): void;
  setBusy(busy: boolean): void;
  recordUsage(usage: PromptUsage): void;
  addRecoveredMarker(): void;
  setToolsMode(mode: ToolDisplayMode): void;
  toggleToolsExpanded(): void;
  readLoop(options: ReadLoopOptions): () => void;
  stop(): void;
}

export function createChatUi({
  tui,
  agent,
  url,
  id,
  tools,
}: ChatUiOptions): ChatUi<Component> {
  const chatContainer = new Container();
  const statusArea = new Container();
  const editor = new Editor(tui, theme.editor);
  editor.setAutocompleteProvider(createChatAutocompleteProvider());
  const header = new Text(
    theme.header(`flue-tui · ${agent}@${url} · ${id}`),
    1,
    1,
  );
  const toolBlocks = new Map<string, ToolBlock>();
  const footer = new StatusFooter({
    agent,
    url,
    id,
    usage: emptyUsageTotals(),
    state: "idle",
  });
  let toolsMode = tools;
  let loader: Loader | undefined;

  tui.addChild(header);
  tui.addChild(chatContainer);
  tui.addChild(statusArea);
  tui.addChild(editor);
  tui.addChild(footer);
  tui.setFocus(editor);

  const requestRender = () => tui.requestRender();

  const addNotice = (text: string) => {
    chatContainer.addChild(new NoticeBlock(text));
    requestRender();
  };

  const setId = (nextId: string) => {
    header.setText(theme.header(`flue-tui · ${agent}@${url} · ${nextId}`));
    footer.setId(nextId);
    requestRender();
  };

  const clearTranscript = () => {
    chatContainer.clear();
    toolBlocks.clear();
    requestRender();
  };

  const setBusy = (busy: boolean) => {
    footer.setState(busy ? "working" : "idle");
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
      const block = new ToolBlock(part, toolsMode);
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

  const setToolsMode = (mode: ToolDisplayMode) => {
    if (toolsMode === mode) {
      return;
    }

    toolsMode = mode;
    for (const block of toolBlocks.values()) {
      block.setDisplayMode(mode);
    }
    requestRender();
  };

  const toggleToolsExpanded = () => {
    if (toolsMode === "hidden") {
      return;
    }
    setToolsMode(toolsMode === "full" ? "collapsed" : "full");
  };

  const recordUsage = (usage: PromptUsage) => {
    footer.recordUsage(usage);
    requestRender();
  };

  const addRecoveredMarker = () => {
    chatContainer.addChild(new Text(theme.muted("(recovered)"), 1, 0));
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
    recordUsage,
    addRecoveredMarker,
    setToolsMode,
    toggleToolsExpanded,
    readLoop,
    stop: () => tui.stop(),
  };
}
