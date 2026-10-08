import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import bidiFactory from "bidi-js";
import { AppError } from "@/lib/auth-policy";

export type PdfFont = { name: string; bytes: Buffer; characters: Set<number> };
const files = ["NotoSans-Regular.ttf", "NotoNaskhArabic-Regular.ttf"];
let cached: Promise<PdfFont[]> | undefined;
export function exportFonts() {
  cached ??= Promise.all(
    files.map(async (file, index) => {
      const bytes = await readFile(
        join(process.cwd(), "public", "export-fonts", file),
      );
      const font = fontkit.create(bytes);
      return {
        name: `export-font-${index}`,
        bytes,
        characters: new Set(font.characterSet),
      };
    }),
  ).catch((error) => {
    cached = undefined;
    throw error;
  });
  return cached;
}
const bidi = bidiFactory();
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const ignorable =
  /^[\u200c\u200d\u200e\u200f\u202a-\u202e\u2066-\u2069\ufe00-\ufe0f]$/u;
export type PdfTextRun = { text: string; font: PdfFont; rtl: boolean };

// Resolve visual ordering across scripts, but keep each shaped run in logical
// order. PDFKit/fontkit handles ligatures and mark offsets within each run.
export function pdfTextRuns(
  text: string,
  fonts: PdfFont[],
  direction?: "ltr" | "rtl",
) {
  const embedding = bidi.getEmbeddingLevels(text, direction);
  const mirrored = bidi.getMirroredCharactersMap(text, embedding.levels);
  const runs: (PdfTextRun & { level: number })[] = [];
  const mapping: number[] = [];
  for (const { segment, index } of graphemes.segment(text)) {
    const supports = (font: PdfFont) =>
      [...segment].every(
        (char) =>
          ignorable.test(char) || font.characters.has(char.codePointAt(0)!),
      );
    const previous = runs.at(-1);
    const font =
      previous && supports(previous.font)
        ? previous.font
        : fonts.find(supports);
    if (!font)
      throw new AppError(
        "EXPORT_FONT_UNSUPPORTED",
        "This PDF font set cannot render some characters. Use ZIP to preserve the text or register a PDF renderer with additional fonts.",
        409,
      );
    const level = embedding.levels[index];
    let run = previous;
    if (!run || run.font !== font || run.level !== level) {
      run = { text: "", font, level, rtl: Boolean(level & 1) };
      runs.push(run);
    }
    for (let offset = index; offset < index + segment.length; offset++) {
      run.text += mirrored.get(offset) ?? text[offset];
      mapping[offset] = runs.length - 1;
    }
  }
  const order = Array.from({ length: text.length }, (_, index) => index);
  for (const [start, end] of bidi.getReorderSegments(text, embedding)) {
    const reversed = order.slice(start, end + 1).reverse();
    order.splice(start, reversed.length, ...reversed);
  }
  const visual: PdfTextRun[] = [];
  let last = -1;
  for (const index of order) {
    const run = mapping[index];
    if (run !== last) {
      visual.push(runs[run]);
      last = run;
    }
  }
  return { runs: visual, rtl: Boolean(embedding.paragraphs[0]?.level & 1) };
}

export function textGraphemes(text: string) {
  return [...graphemes.segment(text)].map((item) => item.segment);
}
export function paragraphDirection(text: string): "ltr" | "rtl" {
  return bidi.getEmbeddingLevels(text).paragraphs[0]?.level & 1 ? "rtl" : "ltr";
}
