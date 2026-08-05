import { afterEach, describe, expect, it } from "vitest";
import { createCodeClipboardContent } from "@/utils/rich-clipboard";
// Explicit `.web` suffix, matching `surface.web.tsx` — tsc does not apply Metro's
// platform extension resolution.
import { createAssistantSelectionClipboardContent } from "./content.web";

/**
 * The fixture mirrors what `highlighted-code-block.tsx` and the Markdown render
 * rules emit: `data-paseo-markdown-tag` wrappers, syntax tokens split across
 * sibling spans, newlines as their own text nodes, and the hover Copy button
 * living *inside* the `pre`. Keep it in sync with the renderer — the e2e spec
 * covers the same cases against the real thing.
 */
function renderFixture(options: { language?: string } = {}): HTMLElement {
  const message = el("div", { "data-testid": "assistant-message" });

  message.append(
    el(
      "div",
      { "data-paseo-markdown-tag": "p" },
      el("span", {}, "Run "),
      el("span", { "data-paseo-markdown-tag": "code" }, "apply_patch"),
      el("span", {}, " first."),
    ),
  );

  const fenceAttributes: Record<string, string> = { "data-paseo-markdown-tag": "pre" };
  if (options.language !== undefined) {
    fenceAttributes["data-paseo-markdown-language"] = options.language;
  }
  message.append(
    el(
      "div",
      fenceAttributes,
      el(
        "span",
        { "data-paseo-markdown-tag": "code" },
        el("span", {}, "const"),
        el("span", {}, " answer"),
        el("span", {}, " = 1;"),
        "\n",
        el("span", {}, "  if"),
        el("span", {}, " (answer)"),
        el("span", {}, " {"),
        "\n",
        el("span", {}, "    doThing();"),
      ),
      el("div", { "data-paseo-markdown-ignore": "true" }, el("span", {}, "Copy")),
    ),
  );

  message.append(el("div", { "data-paseo-markdown-tag": "p" }, el("span", {}, "After the block.")));

  document.body.append(message);
  return message;
}

function el(
  tag: string,
  attributes: Record<string, string>,
  ...children: Array<Node | string>
): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
}

/** The single text node whose content is exactly `text`. */
function textNode(root: Node, text: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const matches: Text[] = [];
  while (walker.nextNode()) {
    if (walker.currentNode.textContent === text) {
      matches.push(walker.currentNode as Text);
    }
  }
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one text node "${text}", found ${matches.length}`);
  }
  return matches[0];
}

function copy(start: [Text, number], end: [Text, number]) {
  const range = document.createRange();
  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1]);
  const selection = window.getSelection();
  if (!selection) {
    throw new Error("Expected a window selection");
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return createAssistantSelectionClipboardContent(selection);
}

/** Select from the start of one text node to the end of another. */
function copyWhole(root: Node, startText: string, endText: string) {
  const start = textNode(root, startText);
  const end = textNode(root, endText);
  return copy([start, 0], [end, endText.length]);
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("createAssistantSelectionClipboardContent inside code", () => {
  it("copies a partial word in a fence verbatim, with no fence syntax", () => {
    const message = renderFixture({ language: "typescript" });

    const content = copy([textNode(message, " answer"), 1], [textNode(message, " answer"), 4]);

    expect(content?.plainText).toBe("ans");
    expect(content?.html).toBe('<meta charset="utf-8"><code>ans</code>');
  });

  it("keeps newlines and indentation across two fence lines", () => {
    const message = renderFixture({ language: "typescript" });

    const content = copyWhole(message, "const", " {");

    expect(content?.plainText).toBe("const answer = 1;\n  if (answer) {");
    expect(content?.html).toBe(
      '<meta charset="utf-8"><pre><code class="language-typescript">const answer = 1;\n  if (answer) {</code></pre>',
    );
  });

  it("fires when the common ancestor is an element rather than a text node", () => {
    const message = renderFixture({ language: "typescript" });

    // Spanning two token spans makes `commonAncestorContainer` the `code` element.
    const content = copy([textNode(message, "const"), 1], [textNode(message, " answer"), 4]);

    expect(content?.plainText).toBe("onst ans");
    expect(content?.html).toBe('<meta charset="utf-8"><code>onst ans</code>');
  });

  it("drops the hover copy button from a whole-block selection", () => {
    const message = renderFixture({ language: "typescript" });

    const content = copyWhole(message, "const", "Copy");

    expect(content?.plainText).toBe("const answer = 1;\n  if (answer) {\n    doThing();");
    expect(content?.plainText).not.toContain("Copy");
  });

  it("returns null when the selection contains only ignored content", () => {
    const message = renderFixture({ language: "typescript" });

    expect(copyWhole(message, "Copy", "Copy")).toBeNull();
  });

  it("copies whitespace-only code selections as the whitespace itself", () => {
    const message = renderFixture({ language: "typescript" });

    const content = copy([textNode(message, "  if"), 0], [textNode(message, "  if"), 2]);

    expect(content?.plainText).toBe("  ");
  });

  it("omits the language class when the fence has no info string", () => {
    const message = renderFixture();

    const content = copyWhole(message, "const", " {");

    expect(content?.html).toBe(
      '<meta charset="utf-8"><pre><code>const answer = 1;\n  if (answer) {</code></pre>',
    );
  });

  it("escapes a fence info string that would otherwise break out of the attribute", () => {
    const message = renderFixture({ language: 'ts" onload="x' });

    const content = copyWhole(message, "const", " {");

    expect(content?.html).toContain('class="language-ts&quot; onload=&quot;x"');
    expect(content?.html).not.toContain('onload="x"');
  });

  it("copies partial and whole inline code without backticks", () => {
    const message = renderFixture({ language: "typescript" });

    const partial = copy(
      [textNode(message, "apply_patch"), 0],
      [textNode(message, "apply_patch"), 5],
    );
    expect(partial?.plainText).toBe("apply");
    expect(partial?.html).toBe('<meta charset="utf-8"><code>apply</code>');

    const whole = copyWhole(message, "apply_patch", "apply_patch");
    expect(whole?.plainText).toBe("apply_patch");
    expect(whole?.html).toBe('<meta charset="utf-8"><code>apply_patch</code>');
  });

  it("keeps the fence when the selection reaches out of the code block into prose", () => {
    const message = renderFixture({ language: "typescript" });

    const content = copyWhole(message, "  if", "After the block.");

    expect(content?.plainText).toContain("```typescript");
    expect(content?.plainText).toContain("After the block.");
  });

  it("leaves prose-only selections on the Markdown path", () => {
    const message = renderFixture({ language: "typescript" });

    const content = copyWhole(message, "After the block.", "After the block.");

    expect(content?.plainText).toBe("After the block.");
  });
});

describe("createCodeClipboardContent", () => {
  it("escapes html-significant characters in the code body", () => {
    const content = createCodeClipboardContent('if (a < b && c > "d") {', { block: false });

    expect(content.plainText).toBe('if (a < b && c > "d") {');
    expect(content.html).toContain("if (a &lt; b &amp;&amp; c &gt;");
    expect(content.html).not.toContain("<b");
  });

  it("omits the language class for blank and missing info strings", () => {
    expect(createCodeClipboardContent("x\ny", { block: true }).html).toContain("<pre><code>");
    expect(createCodeClipboardContent("x\ny", { block: true, language: "  " }).html).toContain(
      "<pre><code>",
    );
    expect(createCodeClipboardContent("x\ny", { block: true, language: "ts" }).html).toContain(
      '<pre><code class="language-ts">',
    );
  });
});
