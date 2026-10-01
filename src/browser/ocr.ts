import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorker, PSM } from "tesseract.js";

export type OcrBox = { x0: number; y0: number; x1: number; y1: number };
export type OcrWord = { text: string; confidence: number; box: OcrBox };
export type OcrLine = { text: string; confidence: number; box: OcrBox; words: OcrWord[] };
export type OcrContentMode = "general" | "digits";
type OcrSymbol = { text: string; confidence: number; bbox: OcrBox };
type OcrBlockWord = { text: string; confidence: number; bbox: OcrBox; symbols?: OcrSymbol[] };
type OcrBlockLine = { text: string; confidence: number; bbox: OcrBox; words?: OcrBlockWord[] };
type OcrBlock = { paragraphs?: Array<{ lines?: OcrBlockLine[] }> };
type ScreenshotPixels = { width: number; height: number };
type OcrWorker = Awaited<ReturnType<typeof createWorker>>;

let workerLanguage = "";
let workerPromise: Promise<OcrWorker> | undefined;
let recognitionQueue: Promise<void> = Promise.resolve();

function parseLanguages() {
  const raw = process.env.AGENT_DECISION_OCR_LANG?.trim() || "eng";
  const languages = raw.split(/[+,]/).map((value) => value.trim()).filter(Boolean);
  if (!languages.length || languages.length > 4 || languages.some((value) => !/^[a-z0-9_]{2,16}$/i.test(value))) {
    throw new Error("AGENT_DECISION_OCR_LANG must contain one to four Tesseract language codes, such as eng or eng+tur.");
  }
  return languages;
}

function getWorker(languages: string[]) {
  const languageKey = languages.join("+");
  if (workerLanguage === languageKey && workerPromise) return workerPromise;

  const cachePath = path.resolve(process.env.AGENT_DECISION_OCR_CACHE_DIR ?? path.join(os.homedir(), ".agent-decision-kit", "ocr-cache"));
  const promise = mkdir(cachePath, { recursive: true }).then(() => createWorker(languages, 1, {
    cachePath,
    logger: () => undefined,
    ...(process.env.AGENT_DECISION_OCR_LANG_PATH ? { langPath: process.env.AGENT_DECISION_OCR_LANG_PATH } : {}),
  }));
  workerLanguage = languageKey;
  workerPromise = promise;
  void promise.catch(() => {
    if (workerPromise === promise) {
      workerPromise = undefined;
      workerLanguage = "";
    }
  });
  return promise;
}

function serialize<T>(run: () => Promise<T>): Promise<T> {
  const current = recognitionQueue.then(run, run);
  recognitionQueue = current.then(() => undefined, () => undefined);
  return current;
}

export function formatOcrLines(blocks: readonly OcrBlock[] | null | undefined, maxLines = 40, contentMode: OcrContentMode = "general") {
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 80) throw new Error("maxLines must be an integer from 1 to 80.");
  const lines = (blocks ?? []).flatMap((block) => (block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? []))
    .map((line) => ({
      text: line.text.replace(/\s+/g, " ").trim().slice(0, 240),
      confidence: Math.max(0, Math.min(100, Math.round(line.confidence))),
      box: { x0: Math.max(0, Math.round(line.bbox.x0)), y0: Math.max(0, Math.round(line.bbox.y0)), x1: Math.max(0, Math.round(line.bbox.x1)), y1: Math.max(0, Math.round(line.bbox.y1)) },
      words: (contentMode === "digits"
        ? (line.words ?? []).flatMap((word) => word.symbols?.length ? word.symbols : [word])
        : line.words ?? []).filter((word) => contentMode !== "digits" || !isWideDigitSymbol(word)).slice(0, 80).map((word) => ({
        text: word.text.replace(/\s+/g, " ").trim().slice(0, 100),
        confidence: Math.max(0, Math.min(100, Math.round(word.confidence))),
        box: { x0: Math.max(0, Math.round(word.bbox.x0)), y0: Math.max(0, Math.round(word.bbox.y0)), x1: Math.max(0, Math.round(word.bbox.x1)), y1: Math.max(0, Math.round(word.bbox.y1)) },
      })).filter((word) => word.text.length > 0),
    }))
    .filter((line) => line.text.length > 0 && (line.confidence >= 20 || contentMode === "digits" && line.words.some((word) => word.confidence >= 40)))
    .sort((left, right) => left.box.y0 - right.box.y0 || left.box.x0 - right.box.x0);

  const result: OcrLine[] = [];
  let remainingCharacters = 6_000;
  let remainingWordCharacters = 6_000;
  let remainingWords = 400;
  for (const line of lines) {
    if (result.length >= maxLines || remainingCharacters <= 0) break;
    const text = line.text.slice(0, remainingCharacters);
    const words: OcrWord[] = [];
    for (const word of line.words) {
      if (remainingWords <= 0 || remainingWordCharacters <= 0) break;
      const wordText = word.text.slice(0, remainingWordCharacters);
      if (!wordText) break;
      words.push({ ...word, text: wordText });
      remainingWords -= 1;
      remainingWordCharacters -= wordText.length;
    }
    result.push({ ...line, text, words });
    remainingCharacters -= text.length;
  }
  return result;
}

export function findExactOcrTextMatches(lines: readonly OcrLine[], requestedText: string) {
  const target = normalizeOcrTokens(requestedText);
  if (!target.length || target.length > 20) return [];
  const matches: Array<{ text: string; box: OcrBox; confidence: number }> = [];

  for (const line of lines) {
    const entries = line.words.length
      ? line.words.flatMap((word, wordIndex) => normalizeOcrTokens(word.text).map((token) => ({ token, wordIndex, word })))
      : normalizeOcrTokens(line.text).map((token) => ({ token, wordIndex: -1, word: { text: line.text, confidence: line.confidence, box: line.box } }));
    for (let start = 0; start <= entries.length - target.length; start += 1) {
      const span = entries.slice(start, start + target.length);
      if (!span.every((entry, index) => entry.token === target[index])) continue;
      const words = [...new Set(span.map((entry) => entry.wordIndex))].map((wordIndex) =>
        wordIndex < 0 ? { text: line.text, confidence: line.confidence, box: line.box } : line.words[wordIndex]!,
      );
      const confidence = Math.min(...words.map((word) => word.confidence));
      if (confidence < 40) continue;
      matches.push({
        text: span.map((entry) => entry.token).join(" "),
        box: {
          x0: Math.min(...words.map((word) => word.box.x0)),
          y0: Math.min(...words.map((word) => word.box.y0)),
          x1: Math.max(...words.map((word) => word.box.x1)),
          y1: Math.max(...words.map((word) => word.box.y1)),
        },
        confidence,
      });
    }
  }
  return matches;
}

function normalizeOcrTokens(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u).filter(Boolean);
}

export function recognizeScreenshotText(png: Buffer, maxLines = 40, segmentationMode: "automatic" | "sparse-text" = "automatic", contentMode: OcrContentMode = "general", screenshotPixels?: ScreenshotPixels) {
  return serialize(async () => {
    const startedAt = performance.now();
    const languages = parseLanguages();
    const workerStartedAt = performance.now();
    const worker = await getWorker(languages);
    const initializationMs = Math.round(performance.now() - workerStartedAt);
    await worker.setParameters({
      tessedit_pageseg_mode: contentMode === "digits" ? PSM.SINGLE_BLOCK : segmentationMode === "sparse-text" ? PSM.SPARSE_TEXT : PSM.AUTO,
      tessedit_char_whitelist: contentMode === "digits" ? "0123456789" : "",
      classify_bln_numeric_mode: contentMode === "digits" ? "1" : "0",
    });
    const recognitionStartedAt = performance.now();
    const { data } = await worker.recognize(png, {}, { blocks: true });
    const blocks = [...(data.blocks ?? [])];
    let cropRetryCount = 0;
    let symbolRetryCount = 0;
    if (contentMode === "digits" && screenshotPixels && screenshotPixels.width > 0 && screenshotPixels.height > 0) {
      const wideSymbols = findWideDigitSymbols(blocks).slice(0, 4);
      for (const symbol of wideSymbols) {
        for (const rectangle of splitSymbolIntoRegions(symbol, screenshotPixels)) {
          const retry = await worker.recognize(png, { rectangle }, { blocks: true });
          blocks.push(...(retry.data.blocks ?? []));
          cropRetryCount += 1;
        }
      }

      const repeatedSymbols = findRepeatedDigitSymbols(blocks).slice(0, 8);
      if (repeatedSymbols.length) {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_CHAR,
          tessedit_char_whitelist: "0123456789",
          classify_bln_numeric_mode: "1",
        });
        for (const repeated of repeatedSymbols) {
          const rectangle = makeSymbolRectangle(repeated.symbol, screenshotPixels);
          if (!rectangle) continue;
          const retry = await worker.recognize(png, { rectangle }, { blocks: true });
          symbolRetryCount += 1;
          const recognized = collectDigitSymbols(retry.data.blocks ?? []);
          if (recognized.length !== 1 || recognized[0]!.confidence < 40) continue;
          repeated.symbol.text = recognized[0]!.text;
          repeated.symbol.confidence = recognized[0]!.confidence;
          if (repeated.word.symbols?.length === 1) {
            repeated.word.text = repeated.symbol.text;
            repeated.word.confidence = repeated.symbol.confidence;
            if (repeated.line.words?.length === 1) {
              repeated.line.text = repeated.symbol.text;
              repeated.line.confidence = repeated.symbol.confidence;
            }
          }
        }
      }
    }
    const recognitionMs = Math.round(performance.now() - recognitionStartedAt);
    return {
      engine: "tesseract.js",
      language: languages.join("+"),
      segmentationMode,
      contentMode,
      cropRetryCount,
      symbolRetryCount,
      initializationMs,
      recognitionMs,
      latencyMs: Math.round(performance.now() - startedAt),
      lines: formatOcrLines(blocks, maxLines, contentMode),
    };
  });
}

function isWideDigitSymbol(symbol: { text: string; bbox: OcrBox }) {
  const width = symbol.bbox.x1 - symbol.bbox.x0;
  const height = symbol.bbox.y1 - symbol.bbox.y0;
  return /^\d$/.test(symbol.text.trim()) && height >= 4 && width > Math.max(22, height * 1.8);
}

function findWideDigitSymbols(blocks: readonly OcrBlock[]) {
  return blocks.flatMap((block) => (block.paragraphs ?? []).flatMap((paragraph) => (paragraph.lines ?? []).flatMap((line) => (line.words ?? []).flatMap((word) => (word.symbols ?? []).filter(isWideDigitSymbol)))));
}

function collectDigitSymbols(blocks: readonly OcrBlock[]) {
  const symbols = blocks.flatMap((block) => (block.paragraphs ?? []).flatMap((paragraph) => (paragraph.lines ?? []).flatMap((line) => (line.words ?? []).flatMap((word) => word.symbols ?? []))));
  return symbols.filter((symbol) => /^\d$/.test(symbol.text.trim()) && !isWideDigitSymbol(symbol));
}

function findRepeatedDigitSymbols(blocks: readonly OcrBlock[]) {
  const unique = new Map<string, { symbol: OcrSymbol; word: OcrBlockWord; line: OcrBlockLine }>();
  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          for (const symbol of word.symbols ?? []) {
            if (!/^\d$/.test(symbol.text.trim()) || isWideDigitSymbol(symbol)) continue;
            const key = `${symbol.bbox.x0},${symbol.bbox.y0},${symbol.bbox.x1},${symbol.bbox.y1}`;
            if (!unique.has(key)) unique.set(key, { symbol, word, line });
          }
        }
      }
    }
  }
  const distinctSymbols = [...unique.values()];
  const counts = new Map<string, number>();
  for (const repeated of distinctSymbols) counts.set(repeated.symbol.text.trim(), (counts.get(repeated.symbol.text.trim()) ?? 0) + 1);
  return distinctSymbols.filter((repeated) => (counts.get(repeated.symbol.text.trim()) ?? 0) > 1);
}

function makeSymbolRectangle(symbol: OcrSymbol, screenshotPixels: ScreenshotPixels) {
  const { x0, y0, x1, y1 } = symbol.bbox;
  if (![x0, y0, x1, y1].every(Number.isFinite) || x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0 || x1 > screenshotPixels.width || y1 > screenshotPixels.height) return undefined;
  const height = y1 - y0;
  const horizontalPadding = Math.max(4, Math.ceil(height * 0.35));
  const verticalPadding = Math.max(4, Math.ceil(height * 0.25));
  const left = Math.max(0, Math.floor(x0 - horizontalPadding));
  const right = Math.min(screenshotPixels.width, Math.ceil(x1 + horizontalPadding));
  const top = Math.max(0, Math.floor(y0 - verticalPadding));
  const bottom = Math.min(screenshotPixels.height, Math.ceil(y1 + verticalPadding));
  return { left, top, width: right - left, height: bottom - top };
}

function splitSymbolIntoRegions(symbol: OcrSymbol, screenshotPixels: ScreenshotPixels) {
  const height = Math.max(1, symbol.bbox.y1 - symbol.bbox.y0);
  const horizontalPadding = Math.max(3, Math.ceil(height * 0.2));
  const verticalPadding = Math.max(3, Math.ceil(height * 0.2));
  const splitX = Math.floor((symbol.bbox.x0 + symbol.bbox.x1) / 2);
  const left = Math.max(0, Math.floor(symbol.bbox.x0 - horizontalPadding));
  const right = Math.min(screenshotPixels.width, Math.ceil(symbol.bbox.x1 + horizontalPadding));
  const top = Math.max(0, Math.floor(symbol.bbox.y0 - verticalPadding));
  const bottom = Math.min(screenshotPixels.height, Math.ceil(symbol.bbox.y1 + verticalPadding));
  return [
    { left, top, width: Math.max(1, Math.min(right, splitX + horizontalPadding) - left), height: Math.max(1, bottom - top) },
    { left: Math.max(0, splitX - horizontalPadding), top, width: Math.max(1, right - Math.max(0, splitX - horizontalPadding)), height: Math.max(1, bottom - top) },
  ];
}

export async function closeOcrWorker() {
  await recognitionQueue;
  const promise = workerPromise;
  workerPromise = undefined;
  workerLanguage = "";
  if (promise) await promise.then((worker) => worker.terminate(), () => undefined);
}
