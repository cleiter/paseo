import { createAssistantMarkdownParser } from "./assistant-markdown-parser";

const markdownRenderer = createAssistantMarkdownParser();

type ClipboardMimeType = "text/plain" | "text/html";

export interface MarkdownClipboardContent {
  plainText: string;
  html: string;
}

export interface RichClipboardWriter {
  supportsHtml: () => boolean;
  write: (data: Record<ClipboardMimeType, Blob>) => Promise<void>;
}

export interface MarkdownClipboardEnvironment {
  richWriter?: RichClipboardWriter | null;
  writePlainText: (text: string) => Promise<unknown>;
}

export function createMarkdownClipboardContent(markdown: string): MarkdownClipboardContent {
  return {
    plainText: markdown,
    html: `<meta charset="utf-8">${markdownRenderer.render(markdown)}`,
  };
}

export interface CodeClipboardOptions {
  language?: string | null;
  /** Fenced block markup when true, inline `<code>` when false. */
  block: boolean;
}

/**
 * Clipboard payload for a selection that lies entirely inside rendered code.
 *
 * `plainText` is the code exactly as it was selected — no fences, no backticks —
 * so it pastes straight into a shell or editor. The html half keeps the code
 * marked up for rich targets.
 *
 * The fence info string is agent-authored, so the language is escaped as an
 * attribute value rather than interpolated raw.
 */
export function createCodeClipboardContent(
  code: string,
  options: CodeClipboardOptions,
): MarkdownClipboardContent {
  const escapedCode = markdownRenderer.utils.escapeHtml(code);
  if (!options.block) {
    return { plainText: code, html: `<meta charset="utf-8"><code>${escapedCode}</code>` };
  }

  const language = options.language?.trim();
  const className = language
    ? ` class="language-${markdownRenderer.utils.escapeHtml(language)}"`
    : "";
  return {
    plainText: code,
    html: `<meta charset="utf-8"><pre><code${className}>${escapedCode}</code></pre>`,
  };
}

export async function writeMarkdownToRichClipboard(
  markdown: string,
  environment: MarkdownClipboardEnvironment,
): Promise<void> {
  if (environment.richWriter?.supportsHtml()) {
    const content = createMarkdownClipboardContent(markdown);
    try {
      await environment.richWriter.write({
        "text/plain": new Blob([content.plainText], { type: "text/plain" }),
        "text/html": new Blob([content.html], { type: "text/html" }),
      });
      return;
    } catch {
      // Fall through to the plain-text path. Some webviews expose rich clipboard
      // APIs but deny writes depending on focus, permissions, or browser policy.
    }
  }

  await environment.writePlainText(markdown);
}
