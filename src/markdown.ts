// BlockNote JSON ↔ Markdown 양방향 변환기.
//
// hubNote 의 BlockNote 0.49 schema 를 직접 처리합니다 — `@blocknote/core`
// 라이브러리는 인스턴스 메서드만 제공해 Node 환경에서 jsdom 의존을
//요구하므로, 손실 없는 round-trip 만 우리가 직접 보장합니다 (D9).
//
// 처리 범위:
//   Blocks: paragraph / heading(1-3) / bulletListItem / numberedListItem
//           / checkListItem / quote / codeBlock / table / image / divider
//   Inline: text(+styles bold/italic/underline/strike/code) / link
//           / mention(custom — `@username` 패턴, 8자 이상 hubNote 핸들)
//
// 처리 안 하는 것 (문서 round-trip 시 정보 손실):
//   - paragraph / heading 의 textColor / backgroundColor props (callout 색상)
//   - 표 안의 굵게 헤더 row 의 styles
//   - 깊이 있는 nested list (들여쓰기는 round-trip 시 평면화될 수 있음)

interface TextStyles {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
}

interface TextRun {
  type: "text";
  text: string;
  styles?: TextStyles;
}

interface LinkRun {
  type: "link";
  href: string;
  content: InlineContent[];
}

interface MentionRun {
  type: "mention";
  props: { user: string };
}

type InlineContent = TextRun | LinkRun | MentionRun;

export interface Block {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: InlineContent[] | TableContent;
  children?: Block[];
}

interface TableContent {
  type: "tableContent";
  rows: { cells: InlineContent[][] }[];
}

// ──────────────────────────────────────────────────────────────────
// Forward — BlockNote JSON → Markdown
// ──────────────────────────────────────────────────────────────────

export function blocksToMarkdown(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const out: string[] = [];
  for (const block of blocks as Block[]) {
    out.push(...blockToLines(block, 0));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function blockToLines(block: Block, depth: number): string[] {
  switch (block.type) {
    case "paragraph": {
      const txt = inlineToMd(block.content);
      return [txt, ""];
    }
    case "heading": {
      const lvl = clampLevel(block.props?.level);
      return [`${"#".repeat(lvl)} ${inlineToMd(block.content)}`, ""];
    }
    case "bulletListItem":
      return listItem(block, depth, "-");
    case "numberedListItem":
      return listItem(block, depth, "1.");
    case "checkListItem": {
      const checked = block.props?.checked === true ? "x" : " ";
      const indent = "  ".repeat(depth);
      const lines = [`${indent}- [${checked}] ${inlineToMd(block.content)}`];
      for (const child of block.children ?? []) {
        lines.push(...blockToLines(child, depth + 1));
      }
      return lines;
    }
    case "quote":
      return [`> ${inlineToMd(block.content)}`, ""];
    case "codeBlock": {
      const lang = (block.props?.language as string | undefined) ?? "";
      const code = inlineRawText(block.content);
      return ["```" + lang, code, "```", ""];
    }
    case "table":
      return [...tableToMd(block), ""];
    case "image": {
      const url = (block.props?.url as string | undefined) ?? "";
      const caption = (block.props?.caption as string | undefined) ?? "";
      return url ? [`![${caption}](${url})`, ""] : [];
    }
    case "divider":
      return ["---", ""];
    default: {
      // 알 수 없는 type — inline content 만 보존해 정보 손실 최소화
      const txt = inlineToMd(block.content);
      return txt ? [txt, ""] : [];
    }
  }
}

function clampLevel(value: unknown): 1 | 2 | 3 {
  const n = typeof value === "number" ? value : Number(value);
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 1;
}

function listItem(block: Block, depth: number, marker: string): string[] {
  const indent = "  ".repeat(depth);
  const lines = [`${indent}${marker} ${inlineToMd(block.content)}`];
  for (const child of block.children ?? []) {
    lines.push(...blockToLines(child, depth + 1));
  }
  return lines;
}

function inlineToMd(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content as InlineContent[]) {
    parts.push(inlineItemToMd(item));
  }
  return parts.join("");
}

function inlineItemToMd(item: InlineContent): string {
  if (item.type === "text") {
    let s = item.text ?? "";
    const styles = item.styles ?? {};
    // 적용 순서 — 가장 안쪽부터 바깥쪽: code → strike → italic → bold
    // 그래야 `**~~text~~**` 처럼 자연스럽게 nested.
    if (styles.code) s = `\`${s}\``;
    if (styles.strike) s = `~~${s}~~`;
    if (styles.italic) s = `*${s}*`;
    if (styles.bold) s = `**${s}**`;
    return s;
  }
  if (item.type === "link") {
    const inner = inlineToMd(item.content);
    return `[${inner}](${item.href ?? ""})`;
  }
  if (item.type === "mention") {
    const user = item.props?.user ?? "";
    return user ? `@${user}` : "";
  }
  return "";
}

function inlineRawText(content: unknown): string {
  // codeBlock 본문 — styles 무시, 텍스트만 평탄화
  if (!Array.isArray(content)) return "";
  return (content as InlineContent[])
    .map((item) => {
      if (item.type === "text") return item.text ?? "";
      if (item.type === "link") return inlineRawText(item.content);
      if (item.type === "mention") return `@${item.props?.user ?? ""}`;
      return "";
    })
    .join("");
}

function tableToMd(block: Block): string[] {
  const tc = block.content as TableContent | undefined;
  if (!tc || tc.type !== "tableContent" || !Array.isArray(tc.rows)) return [];
  if (tc.rows.length === 0) return [];

  const renderCell = (cell: unknown): string => {
    if (!Array.isArray(cell)) return "";
    return inlineToMd(cell as InlineContent[]).replace(/\|/g, "\\|");
  };

  const headerCells = (tc.rows[0].cells ?? []).map(renderCell);
  const colCount = headerCells.length;
  if (colCount === 0) return [];

  const lines: string[] = [];
  lines.push(`| ${headerCells.join(" | ")} |`);
  lines.push(`| ${Array(colCount).fill("---").join(" | ")} |`);
  for (let i = 1; i < tc.rows.length; i++) {
    const cells = (tc.rows[i].cells ?? []).map(renderCell);
    while (cells.length < colCount) cells.push("");
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines;
}

// ──────────────────────────────────────────────────────────────────
// Reverse — Markdown → BlockNote JSON
// ──────────────────────────────────────────────────────────────────

export function markdownToBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Horizontal rule / divider
    if (/^---+\s*$/.test(line.trim())) {
      blocks.push({ type: "divider" });
      i++;
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        props: { level: headingMatch[1].length },
        content: parseInline(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Fenced code block
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // closing ``` (or end of file)
      blocks.push({
        type: "codeBlock",
        props: language ? { language } : {},
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }

    // Blockquote (consecutive `> ` lines)
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [line.slice(2)];
      i++;
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({
        type: "quote",
        content: parseInline(quoteLines.join(" ")),
      });
      continue;
    }

    // Check list — `- [ ]` / `- [x]`
    const checkMatch = /^(\s*)- \[([ xX])\]\s+(.+?)\s*$/.exec(line);
    if (checkMatch) {
      blocks.push({
        type: "checkListItem",
        props: { checked: checkMatch[2].toLowerCase() === "x" },
        content: parseInline(checkMatch[3]),
      });
      i++;
      continue;
    }

    // Bullet list — `- text` (들여쓰기는 1차 평면화)
    const bulletMatch = /^(\s*)[-*+]\s+(.+?)\s*$/.exec(line);
    if (bulletMatch) {
      blocks.push({
        type: "bulletListItem",
        content: parseInline(bulletMatch[2]),
      });
      i++;
      continue;
    }

    // Numbered list — `1. text`
    const numMatch = /^(\s*)\d+\.\s+(.+?)\s*$/.exec(line);
    if (numMatch) {
      blocks.push({
        type: "numberedListItem",
        content: parseInline(numMatch[2]),
      });
      i++;
      continue;
    }

    // Image (line of just an image)
    const imgMatch = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line.trim());
    if (imgMatch) {
      blocks.push({
        type: "image",
        props: {
          caption: imgMatch[1],
          url: imgMatch[2],
        },
      });
      i++;
      continue;
    }

    // Table — | a | b | followed by | --- | --- |
    if (
      line.trimStart().startsWith("|") &&
      i + 1 < lines.length &&
      /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1])
    ) {
      const tableLines: string[] = [line];
      i++;
      tableLines.push(lines[i]);
      i++;
      while (
        i < lines.length &&
        lines[i].trimStart().startsWith("|") &&
        lines[i].trim() !== ""
      ) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push(parseTable(tableLines));
      continue;
    }

    // Paragraph — gather consecutive non-special lines
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isBlockStart(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({
      type: "paragraph",
      content: parseInline(paraLines.join(" ")),
    });
  }

  return blocks;
}

function isBlockStart(line: string): boolean {
  return (
    /^#{1,3}\s/.test(line) ||
    /^---+\s*$/.test(line.trim()) ||
    line.startsWith("> ") ||
    line.startsWith("```") ||
    /^\s*[-*+]\s/.test(line) ||
    /^\s*\d+\.\s/.test(line) ||
    /^!\[[^\]]*\]\([^)]+\)/.test(line.trim()) ||
    line.trimStart().startsWith("|")
  );
}

function parseTable(lines: string[]): Block {
  if (lines.length < 2) {
    return { type: "paragraph", content: [] };
  }

  const splitRow = (row: string): string[] => {
    const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map((c) => c.trim());
  };

  const header = splitRow(lines[0]);
  const dataRows = lines.slice(2).map(splitRow);

  return {
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: header.map((h) => parseInline(h)) },
        ...dataRows.map((row) => ({
          cells: row.map((c) => parseInline(c)),
        })),
      ],
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// Inline parser — bold / italic / strike / code / link / mention
// ──────────────────────────────────────────────────────────────────

function parseInline(text: string): InlineContent[] {
  const result: InlineContent[] = [];
  let i = 0;

  while (i < text.length) {
    // mention: @username (3-30 chars, lowercase + digit + underscore)
    const mentionMatch = /^@([a-z][a-z0-9_]{2,29})\b/.exec(text.slice(i));
    if (mentionMatch) {
      result.push({ type: "mention", props: { user: mentionMatch[1] } });
      i += mentionMatch[0].length;
      continue;
    }

    // link: [text](url)
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)/.exec(text.slice(i));
    if (linkMatch) {
      result.push({
        type: "link",
        href: linkMatch[2],
        content: parseInline(linkMatch[1]),
      });
      i += linkMatch[0].length;
      continue;
    }

    // code: `text`
    const codeMatch = /^`([^`]+)`/.exec(text.slice(i));
    if (codeMatch) {
      result.push({
        type: "text",
        text: codeMatch[1],
        styles: { code: true },
      });
      i += codeMatch[0].length;
      continue;
    }

    // bold: **text** (must come before italic *...*)
    const boldMatch = /^\*\*([^*]+)\*\*/.exec(text.slice(i));
    if (boldMatch) {
      result.push({
        type: "text",
        text: boldMatch[1],
        styles: { bold: true },
      });
      i += boldMatch[0].length;
      continue;
    }

    // strike: ~~text~~
    const strikeMatch = /^~~([^~]+)~~/.exec(text.slice(i));
    if (strikeMatch) {
      result.push({
        type: "text",
        text: strikeMatch[1],
        styles: { strike: true },
      });
      i += strikeMatch[0].length;
      continue;
    }

    // italic: *text* (single-star, after bold check)
    const italicMatch = /^\*([^*\n]+)\*/.exec(text.slice(i));
    if (italicMatch) {
      result.push({
        type: "text",
        text: italicMatch[1],
        styles: { italic: true },
      });
      i += italicMatch[0].length;
      continue;
    }

    // Plain text — collect until next marker
    const slice = text.slice(i);
    const nextMarker = slice.search(/[*_`@\[~]/);
    if (nextMarker === -1) {
      result.push({ type: "text", text: slice });
      break;
    }
    if (nextMarker === 0) {
      // 마커 char 인데 매치 안 됨 — 1글자만 plain 으로 흘려보내고 진행
      result.push({ type: "text", text: text[i] });
      i++;
      continue;
    }
    result.push({ type: "text", text: slice.slice(0, nextMarker) });
    i += nextMarker;
  }

  return mergeAdjacentPlain(result);
}

function mergeAdjacentPlain(items: InlineContent[]): InlineContent[] {
  const merged: InlineContent[] = [];
  for (const item of items) {
    const prev = merged[merged.length - 1];
    if (
      item.type === "text" &&
      isPlainText(item) &&
      prev &&
      prev.type === "text" &&
      isPlainText(prev)
    ) {
      prev.text += item.text;
    } else {
      merged.push(item);
    }
  }
  return merged;
}

function isPlainText(item: TextRun): boolean {
  const s = item.styles;
  if (!s) return true;
  return !s.bold && !s.italic && !s.underline && !s.strike && !s.code;
}
