import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { renderPdf } from "../../src/lib/server/workspaces/export-pdf";
import {
  exportFonts,
  pdfTextRuns,
} from "../../src/lib/server/workspaces/pdf-text";
import type { ExportSnapshot } from "../../src/lib/contracts/export";
import type { ExportRenderContext } from "../../src/lib/server/workspaces/export-renderers";

test("PDF export renders paginated multilingual documents, checklists and owned images", async () => {
  const png = await sharp({
    create: { width: 800, height: 400, channels: 3, background: "#387a89" },
  })
    .png()
    .toBuffer();
  const imageId = randomUUID();
  const body = [
    "A reusable export document",
    "English text, café, Ελληνικά and Русский remain searchable.",
    "این یک متن فارسی برای بررسی خروجی است.",
    "Mixed English and فارسی text (123) with numbers ۱۲۳۴۵.",
    "فارسی (English 123) و متن دیگر برای بررسی ترتیب نمایش.",
    "سَلام و نوشته با نیم‌فاصله",
    "A long identifier: " + "abcdefghijklmnopqrstuvwxyz".repeat(14),
    ...Array.from(
      { length: 36 },
      (_, i) =>
        `Paragraph ${i + 1}. A saved artifact version remains stable when the workspace changes. This paragraph verifies page flow, readable margins and retained content.`,
    ),
    "END OF ORIGINAL DOCUMENT",
  ].join("\n\n");
  const version = (
    title: string,
    text: string,
    assetId: string | null = null,
  ) => ({
    number: 1,
    title,
    body: text,
    assetId,
    dependencies: [],
    createdAt: "2026-10-08T00:00:00.000Z",
    sourceJobId: null,
    decisionFingerprint: null,
  });
  const snapshot: ExportSnapshot = {
    schemaVersion: 1,
    workspaceId: randomUUID(),
    title: "Creation export - multilingual acceptance",
    capturedAt: "2026-10-08T00:00:00.000Z",
    artifacts: [
      {
        artifactId: randomUUID(),
        version: version("Document sample", body),
        approval: {
          version: 1,
          at: "2026-10-08T00:00:00.000Z",
          reason: "Reviewed the selected version.",
        },
      },
      {
        artifactId: randomUUID(),
        version: version(
          "Owned image",
          "The image is loaded only through its captured private asset identity.",
          imageId,
        ),
        approval: null,
      },
      {
        artifactId: randomUUID(),
        version: {
          ...version("Checklist", "[x] Review\n[ ] Publish"),
          content: {
            type: "checklist",
            version: 1,
            data: {
              title: "Checklist",
              items: [
                { id: randomUUID(), text: "Review the result", done: true },
                {
                  id: randomUUID(),
                  text: "Publish after explicit approval",
                  done: false,
                },
              ],
            },
          },
        },
        approval: null,
      },
    ],
    assets: [
      {
        id: imageId,
        name: "sample.png",
        mime: "image/png",
        bytes: png.length,
        digest: createHash("sha256").update(png).digest("hex"),
      },
    ],
  };
  const progress: number[] = [];
  const context: ExportRenderContext = {
    snapshot,
    maxBytes: 8 * 1024 * 1024,
    signal: new AbortController().signal,
    progress: async (percent) => {
      progress.push(percent);
    },
    readAsset: async (id) => {
      assert.equal(id, imageId);
      return png;
    },
  };
  const bytes = await renderPdf(context);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const parsed = await PDFDocument.load(bytes);
  assert.equal(parsed.getTitle(), snapshot.title);
  assert.ok(parsed.getPageCount() >= 5);
  assert.ok(
    parsed.getPages().every((page) => Math.abs(page.getWidth() - 595.28) < 1),
  );
  assert.ok(progress.includes(85));
  await mkdir("output/pdf", { recursive: true });
  await writeFile("output/pdf/export-fixture.pdf", bytes);
  await assert.rejects(
    renderPdf({ ...context, maxBytes: 100 }),
    /storage limit/,
  );
  await assert.rejects(
    renderPdf({ ...context, readAsset: async () => Buffer.from("changed") }),
    /saved identity/,
  );
  const unsupported = structuredClone(snapshot);
  unsupported.artifacts[0].version.body = "Unsupported script: 中文";
  await assert.rejects(
    renderPdf({ ...context, snapshot: unsupported }),
    /font set/,
  );
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(renderPdf({ ...context, signal: cancelled.signal }), {
    name: "AbortError",
  });
  const runs = pdfTextRuns("English فارسی 123", await exportFonts());
  assert.ok(runs.runs.some((run) => run.rtl));
  assert.ok(runs.runs.some((run) => !run.rtl && run.text.includes("English")));
  const mixed = pdfTextRuns(
    "فارسی (English 123) و متن",
    await exportFonts(),
    "rtl",
  );
  // Parentheses must surround the LTR phrase in visual order after RTL reordering.
  const visual = mixed.runs
    .map((run) =>
      run.rtl && !/\p{Letter}/u.test(run.text)
        ? [...run.text].reverse().join("")
        : run.text,
    )
    .join("");
  assert.ok(visual.includes("(English 123)"), visual);
});
