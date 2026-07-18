import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";

import { theme } from "./theme.js";

export class UserMessageBlock extends Container {
  constructor(text: string) {
    super();
    this.addChild(new Text(`${theme.muted("> ")}${text}`, 1, 1));
  }
}

export class AssistantMessageBlock extends Container {
  private text = "";
  private reasoning = "";

  constructor() {
    super();
    this.rebuild();
  }

  appendDelta(text: string): void {
    this.text += text;
    this.rebuild();
  }

  appendReasoning(text: string): void {
    this.reasoning += text;
    this.rebuild();
  }

  complete(text: string): void {
    this.text = text;
    this.rebuild();
  }

  private rebuild(): void {
    this.clear();
    this.addChild(new Spacer(1));

    if (this.reasoning.length > 0) {
      this.addChild(
        new Markdown(this.reasoning, 1, 0, theme.markdown, {
          color: theme.reasoning,
          italic: true,
        }),
      );
    }

    if (this.text.length > 0) {
      this.addChild(new Markdown(this.text, 1, 0, theme.markdown));
    }
  }
}

export class NoticeBlock extends Text {
  constructor(text: string) {
    super(theme.notice(text.replace(/\s+/g, " ").trim()), 1, 1);
  }
}
