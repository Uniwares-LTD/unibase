import "server-only";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { AppError } from "@/lib/auth-policy";
import {
  artifactRegistry,
  legacyArtifactContent,
} from "@/lib/creation/artifacts";
import {
  boundedExport,
  readExportAsset,
  type ExportRenderContext,
} from "./export-renderers";
import {
  exportFonts,
  pdfTextRuns,
  paragraphDirection,
  textGraphemes,
} from "./pdf-text";

// bidi-js already mirrors punctuation. Disable fontkit's second mirroring pass;
// keep its other shaping features (ligatures and combining marks) enabled.
// PDFKit accepts feature maps, while these typings only describe arrays.
const features = {
  rtlm: false,
  rtla: false,
} as unknown as PDFKit.Mixins.TextOptions["features"];

// Generic document layout. Product renderers can reuse text layout/font helpers
// and the owned render context without changing queue, leases or storage.
export async function renderPdf(context: ExportRenderContext) {
  const fonts = await exportFonts();
  context.signal.throwIfAborted();
  const doc = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    size: "A4",
    margin: 48,
    font: join(process.cwd(), "public", "export-fonts", "NotoSans-Regular.ttf"),
    info: {
      Title: context.snapshot.title,
      Creator: "Creation workspace export",
      CreationDate: new Date(context.snapshot.capturedAt),
      ModDate: new Date(context.snapshot.capturedAt),
    },
  });
  fonts.forEach((font) => doc.registerFont(font.name, font.bytes));
  const chunks: Buffer[] = [];
  let total = 0;
  const output = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > context.maxBytes)
        doc.destroy(
          new AppError(
            "EXPORT_TOO_LARGE",
            "The PDF exceeds the storage limit. Export fewer artifacts.",
            413,
          ),
        );
      else chunks.push(chunk);
    });
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  // A stream can reject during an awaited asset read; observe it immediately.
  void output.catch(() => undefined);
  const abort = () =>
    doc.destroy(
      new AppError("EXPORT_INTERRUPTED", "PDF rendering was cancelled.", 409),
    );
  context.signal.addEventListener("abort", abort, { once: true });
  let y = 0,
    pages = 0,
    progress = 5;
  const deadline = Date.now() + 120000;
  const margin = 48,
    width = 499.28,
    bottom = 777.89;
  const check = () => {
    context.signal.throwIfAborted();
    if (Date.now() > deadline)
      throw new AppError(
        "EXPORT_TOO_LARGE",
        "This PDF took too long to render. Export fewer artifacts.",
        413,
      );
    if (doc.destroyed)
      throw new AppError(
        "EXPORT_TOO_LARGE",
        "The PDF exceeds the storage limit. Export fewer artifacts.",
        413,
      );
  };
  const newPage = () => {
    check();
    if (++pages > 200)
      throw new AppError(
        "EXPORT_TOO_LARGE",
        "PDF exports are limited to 200 pages. Export fewer artifacts.",
        413,
      );
    doc.addPage();
    doc
      .font(fonts[0].name)
      .fontSize(8)
      .fillColor("#52636b")
      .text("ARTIFACT EXPORT", margin, 30, { lineBreak: false });
    doc
      .moveTo(margin, 46)
      .lineTo(margin + width, 46)
      .lineWidth(0.5)
      .strokeColor("#ccd4d9")
      .stroke();
    y = 72;
  };
  const layout = (value: string, size: number, direction: "ltr" | "rtl") => {
    const parsed = pdfTextRuns(value, fonts, direction);
    const runs = parsed.runs.flatMap((run) => {
      // Numbers must retain their bidi-resolved order even when their font's
      // script default is RTL. Shape letter runs together for ligatures/marks.
      const segments = /\p{Letter}/u.test(run.text)
        ? [run.text]
        : run.rtl
          ? textGraphemes(run.text).reverse()
          : textGraphemes(run.text);
      return segments.map((text) => ({
        ...run,
        text,
        width: doc
          .font(run.font.name)
          .fontSize(size)
          .widthOfString(text, { features }),
      }));
    });
    return {
      runs,
      width: runs.reduce((sum, run) => sum + run.width, 0),
      rtl: parsed.rtl,
    };
  };
  const drawLine = (
    value: string,
    size: number,
    color: string,
    direction: "ltr" | "rtl",
  ) => {
    const line = layout(value, size, direction);
    let x = margin + (line.rtl ? width - line.width : 0);
    for (const run of line.runs) {
      doc
        .font(run.font.name)
        .fontSize(size)
        .fillColor(color)
        .text(run.text, x, y, {
          lineBreak: false,
          baseline: "alphabetic",
          features,
        });
      x += run.width;
    }
  };
  async function text(value: string, size = 11, color = "#182b34") {
    const lineHeight = size * 1.7;
    let count = 0;
    for (const paragraph of value
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, "    ")
      .split("\n")) {
      if (!paragraph.trim()) {
        y += size * 0.7;
        continue;
      }
      const direction = paragraphDirection(paragraph);
      let line = "";
      const flush = async () => {
        check();
        if (y + lineHeight > bottom) {
          newPage();
          await context.progress(progress);
        }
        drawLine(line.trimEnd(), size, color, direction);
        y += lineHeight;
        line = "";
        if (++count % 20 === 0) await setImmediate();
      };
      for (const token of paragraph.match(/\S+|\s+/gu) ?? []) {
        check();
        if (layout(line + token, size, direction).width <= width) {
          line += token;
          continue;
        }
        if (line.trim()) await flush();
        if (!token.trim()) continue;
        if (layout(token, size, direction).width <= width) {
          line = token;
          continue;
        }
        // Long URLs/identifiers wrap on grapheme boundaries, never clip or split
        // a combining sequence in the middle of its glyph.
        for (const character of textGraphemes(token)) {
          if (line && layout(line + character, size, direction).width > width)
            await flush();
          if (layout(character, size, direction).width > width)
            throw new AppError(
              "EXPORT_FONT_UNSUPPORTED",
              "A text cluster cannot fit the PDF page. Use ZIP or a custom renderer.",
              409,
            );
          line += character;
        }
      }
      await flush();
      y += size * 0.35;
    }
  }
  try {
    newPage();
    await text(context.snapshot.title, 22);
    await text(
      `Captured ${context.snapshot.capturedAt.replace("T", " ").replace("Z", " UTC")}`,
      9,
      "#52636b",
    );
    y += 14;
    for (let index = 0; index < context.snapshot.artifacts.length; index++) {
      const artifact = context.snapshot.artifacts[index];
      if (index) newPage();
      await text(artifact.version.title, 18);
      await text(
        `Version ${artifact.version.number} | ${artifact.approval ? "Approved when exported" : "Not approved when exported"}`,
        9,
        "#52636b",
      );
      if (artifact.approval?.reason)
        await text(`Approval note: ${artifact.approval.reason}`, 9, "#52636b");
      y += 10;
      const content = legacyArtifactContent(artifact.version);
      const projected = artifactRegistry
        .get(content.type, content.version)
        .project(content.data);
      if (projected.text) await text(projected.text);
      const ids = [
        ...new Set([
          ...projected.assetIds,
          ...(artifact.version.assetId ? [artifact.version.assetId] : []),
        ]),
      ];
      for (const id of ids) {
        check();
        const bytes = await readExportAsset(context, id);
        const metadata = await sharp(bytes).metadata();
        if (!metadata.width || !metadata.height || metadata.format !== "png")
          throw new AppError(
            "EXPORT_ASSET_INVALID",
            "An export image is invalid.",
            409,
          );
        const scale = Math.min(
          1,
          width / metadata.width,
          420 / metadata.height,
        );
        const height = metadata.height * scale,
          imageWidth = metadata.width * scale;
        if (y + height + 16 > bottom) newPage();
        doc.image(bytes, margin + (width - imageWidth) / 2, y, {
          width: imageWidth,
          height,
        });
        y += height + 16;
      }
      progress = Math.round(
        10 + (75 * (index + 1)) / context.snapshot.artifacts.length,
      );
      await context.progress(progress);
    }
    for (let page = 0; page < pages; page++) {
      doc.switchToPage(page);
      doc
        .font(fonts[0].name)
        .fontSize(8)
        .fillColor("#52636b")
        .text(`Page ${page + 1} of ${pages}`, margin, 809, {
          lineBreak: false,
        });
    }
    check();
    doc.end();
    return boundedExport(await output, context.maxBytes);
  } catch (error) {
    doc.destroy();
    throw error;
  } finally {
    context.signal.removeEventListener("abort", abort);
  }
}
