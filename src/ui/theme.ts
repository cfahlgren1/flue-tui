import type {
  EditorTheme,
  MarkdownTheme,
  SelectListTheme,
} from "@earendil-works/pi-tui";
import chalk from "chalk";

const selectList = {
  selectedPrefix: chalk.cyan,
  selectedText: chalk.bold,
  description: chalk.dim,
  scrollInfo: chalk.dim,
  noMatch: chalk.dim,
} satisfies SelectListTheme;

const markdown = {
  heading: chalk.bold.cyan,
  link: chalk.cyan,
  linkUrl: chalk.dim,
  code: chalk.yellow,
  codeBlock: chalk.white,
  codeBlockBorder: chalk.dim,
  quote: chalk.italic,
  quoteBorder: chalk.dim,
  hr: chalk.dim,
  listBullet: chalk.cyan,
  bold: chalk.bold,
  italic: chalk.italic,
  strikethrough: chalk.strikethrough,
  underline: chalk.underline,
} satisfies MarkdownTheme;

const editor = {
  borderColor: chalk.dim,
  selectList,
} satisfies EditorTheme;

export const theme = {
  editor,
  markdown,
  loader: {
    spinner: chalk.cyan,
    message: chalk.dim,
  },
  header: chalk.dim,
  muted: chalk.dim,
  notice: chalk.dim.italic,
  reasoning: chalk.dim.italic,
  toolRunning: chalk.cyan,
  toolSuccess: chalk.green,
  toolError: chalk.red,
};
