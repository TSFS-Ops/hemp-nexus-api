/**
 * Hidden audit export page — not linked from any menu.
 *
 * Loads the read-only audit report from /docs/platform-audit-report.md and
 * offers a client-side "Download as Word (.docx)" button. The Word file
 * content is generated from the same markdown source so it is identical.
 *
 * Created solely to satisfy Section D of the audit deliverable brief.
 */
import { useEffect, useState } from "react";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
} from "docx";
import { saveAs } from "file-saver";
// Vite raw import — bundles the markdown as a string at build time.
// eslint-disable-next-line import/no-unresolved
import reportMarkdown from "../../docs/platform-audit-report.md?raw";

type Block =
  | { kind: "h1" | "h2" | "h3" | "h4"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "hr" }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "code"; text: string };

function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    // Headings
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length as 1 | 2 | 3 | 4;
      const kind = (`h${level}` as "h1" | "h2" | "h3" | "h4");
      blocks.push({ kind, text: h[2].trim() });
      i++;
      continue;
    }

    // Table
    if (line.trim().startsWith("|") && lines[i + 1]?.trim().startsWith("|")) {
      const sep = lines[i + 1];
      if (/\|\s*:?-{2,}/.test(sep)) {
        const parseRow = (l: string) =>
          l
            .trim()
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((c) => c.trim());
        const header = parseRow(line);
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          rows.push(parseRow(lines[i]));
          i++;
        }
        blocks.push({ kind: "table", header, rows });
        continue;
      }
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, "").trim());
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, "").trim());
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Paragraph (collect consecutive non-empty, non-special lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith("|")
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      blocks.push({ kind: "p", text: paraLines.join(" ").trim() });
    }
  }
  return blocks;
}

/** Render markdown inline formatting (`**bold**`, `` `code` ``, `*em*`) as TextRuns. */
function inlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, m.index) }));
    }
    const t = m[0];
    if (t.startsWith("**")) {
      runs.push(new TextRun({ text: t.slice(2, -2), bold: true }));
    } else if (t.startsWith("`")) {
      runs.push(new TextRun({ text: t.slice(1, -1), font: "Consolas" }));
    } else {
      runs.push(new TextRun({ text: t.slice(1, -1), italics: true }));
    }
    lastIndex = m.index + t.length;
  }
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex) }));
  }
  return runs.length ? runs : [new TextRun({ text })];
}

function blocksToDocxChildren(blocks: Block[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const headingMap: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    h1: HeadingLevel.HEADING_1,
    h2: HeadingLevel.HEADING_2,
    h3: HeadingLevel.HEADING_3,
    h4: HeadingLevel.HEADING_4,
  };
  for (const b of blocks) {
    if (b.kind === "h1" || b.kind === "h2" || b.kind === "h3" || b.kind === "h4") {
      out.push(
        new Paragraph({
          heading: headingMap[b.kind],
          children: inlineRuns(b.text),
          spacing: { before: 200, after: 120 },
        }),
      );
    } else if (b.kind === "p") {
      out.push(
        new Paragraph({
          children: inlineRuns(b.text),
          spacing: { after: 120 },
        }),
      );
    } else if (b.kind === "ul" || b.kind === "ol") {
      for (const item of b.items) {
        out.push(
          new Paragraph({
            children: inlineRuns(item),
            bullet: b.kind === "ul" ? { level: 0 } : undefined,
            numbering: b.kind === "ol" ? { reference: "ordered", level: 0 } : undefined,
            spacing: { after: 60 },
          }),
        );
      }
    } else if (b.kind === "hr") {
      out.push(
        new Paragraph({
          text: "",
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 },
          },
          spacing: { before: 120, after: 120 },
        }),
      );
    } else if (b.kind === "table") {
      const border = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
      const cellBorders = { top: border, bottom: border, left: border, right: border };
      const headerRow = new TableRow({
        tableHeader: true,
        children: b.header.map(
          (h) =>
            new TableCell({
              borders: cellBorders,
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              shading: { fill: "F1F5F9", type: "clear", color: "auto" },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: h, bold: true })],
                  alignment: AlignmentType.LEFT,
                }),
              ],
            }),
        ),
      });
      const bodyRows = b.rows.map(
        (r) =>
          new TableRow({
            children: b.header.map((_, ci) => {
              const text = r[ci] ?? "";
              return new TableCell({
                borders: cellBorders,
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: inlineRuns(text) })],
              });
            }),
          }),
      );
      out.push(
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          rows: [headerRow, ...bodyRows],
        }),
      );
      out.push(new Paragraph({ text: "", spacing: { after: 80 } }));
    }
  }
  return out;
}

async function buildAndDownloadDocx(markdown: string) {
  const blocks = parseMarkdown(markdown);
  const children = blocksToDocxChildren(blocks);

  const doc = new Document({
    creator: "Izenzo Independent Audit",
    title: "Izenzo Platform — Independent Forensic Audit Report",
    description: "Read-only audit exported from docs/platform-audit-report.md",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    numbering: {
      config: [
        {
          reference: "ordered",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, "Izenzo_Platform_Audit_Report.docx");
}

export default function AuditExport() {
  const [markdown, setMarkdown] = useState<string>("");
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMarkdown((reportMarkdown as unknown as string) ?? "");
  }, []);

  const onDownload = async () => {
    setError(null);
    setBuilding(true);
    try {
      await buildAndDownloadDocx(markdown);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build .docx");
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "32px 24px",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        color: "#0F172A",
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
        Platform Audit Export
      </h1>
      <p style={{ color: "#475569", fontSize: 14, marginBottom: 24 }}>
        Hidden route. Not linked from any menu. Downloads the audit report
        located at <code>docs/platform-audit-report.md</code> as a Microsoft
        Word (.docx) document rendered client-side.
      </p>
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <button
          onClick={onDownload}
          disabled={building || !markdown}
          style={{
            background: "#047857",
            color: "white",
            border: "none",
            padding: "10px 16px",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            cursor: building ? "not-allowed" : "pointer",
            opacity: building ? 0.6 : 1,
          }}
        >
          {building ? "Building .docx…" : "Download as Word (.docx)"}
        </button>
      </div>
      {error && (
        <div
          style={{
            padding: 12,
            border: "1px solid #FCA5A5",
            background: "#FEF2F2",
            color: "#991B1B",
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
      <details style={{ marginTop: 24 }}>
        <summary style={{ cursor: "pointer", color: "#334155", fontSize: 13 }}>
          Preview report source (markdown)
        </summary>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontSize: 12,
            lineHeight: 1.5,
            marginTop: 12,
            padding: 16,
            background: "#F8FAFC",
            border: "1px solid #E2E8F0",
            borderRadius: 6,
            maxHeight: 600,
            overflow: "auto",
          }}
        >
          {markdown}
        </pre>
      </details>
    </div>
  );
}
