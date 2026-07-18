import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";

import { sanitizeText } from "./sanitize.js";
import { theme } from "./theme.js";

export class UserMessageBlock extends Container {
  private text: string;

  constructor(text: string) {
    super();
    this.text = sanitizeText(text);
    this.rebuild();
  }

  setText(text: string): void {
    if (this.text === text) {
      return;
    }
    this.text = sanitizeText(text);
    this.rebuild();
  }

  private rebuild(): void {
    this.clear();
    this.addChild(new Text(`${theme.muted("> ")}${this.text}`, 1, 1));
  }
}

export class AssistantMessageBlock extends Container {
  private text: string;

  constructor(text: string) {
    super();
    this.text = sanitizeText(text);
    this.rebuild();
  }

  setText(text: string): void {
    if (this.text === text) {
      return;
    }
    this.text = sanitizeText(text);
    this.rebuild();
  }

  private rebuild(): void {
    this.clear();
    this.addChild(new Spacer(1));

    if (this.text.length > 0) {
      this.addChild(new Markdown(this.text, 1, 0, theme.markdown));
    }
  }
}

export class ReasoningBlock extends Container {
  private text: string;

  constructor(text: string) {
    super();
    this.text = sanitizeText(text);
    this.rebuild();
  }

  setText(text: string): void {
    if (this.text === text) {
      return;
    }
    this.text = sanitizeText(text);
    this.rebuild();
  }

  private rebuild(): void {
    this.clear();
    this.addChild(new Spacer(1));
    if (this.text.length > 0) {
      this.addChild(
        new Markdown(this.text, 1, 0, theme.markdown, {
          color: theme.reasoning,
          italic: true,
        }),
      );
    }
  }
}

export class NoticeBlock extends Text {
  constructor(text: string) {
    super(
      theme.notice(sanitizeText(text).replace(/\s+/g, " ").trim()),
      1,
      1,
    );
  }
}
