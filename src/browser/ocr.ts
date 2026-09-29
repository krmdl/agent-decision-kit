import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorker } from "tesseract.js";

export type OcrBox = { x0: number; y0: number; x1: number; y1: number };
export type OcrWord = { text: string; confidence: number; box: OcrBox };
export type OcrLine = { text: string; confidence: number; box: OcrBox; words: OcrWord[] };
type OcrBlock = { paragraphs?: Array<{ lines?: Array<{ text: string; confidence: number; bbox: OcrBox; words?: Array<{ text: string; confidence: number; bbox: OcrBox }> }> }> };
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

export function formatOcrLines(blocks: readonly OcrBlock[] | null | undefined, maxLines = 40) {
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 80) throw new Error("maxLines must be an integer from 1 to 80.");
  const lines = (blocks ?? []).flatMap((block) => (block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? []))
    .map((line) => ({
      text: line.text.replace(/\s+/g, " ").trim().slice(0, 240),
      confidence: Math.max(0, Math.min(100, Math.round(line.confidence))),
      box: { x0: Math.max(0, Math.round(line.bbox.x0)), y0: Math.max(0, Math.round(line.bbox.y0)), x1: Math.max(0, Math.round(line.bbox.x1)), y1: Math.max(0, Math.round(line.bbox.y1)) },
      words: (line.words ?? []).slice(0, 80).map((word) => ({
        text: word.text.replace(/\s+/g, " ").trim().slice(0, 100),
        confidence: Math.max(0, Math.min(100, Math.round(word.confidence))),
        box: { x0: Math.max(0, Math.round(word.bbox.x0)), y0: Math.max(0, Math.round(word.bbox.y0)), x1: Math.max(0, Math.round(word.bbox.x1)), y1: Math.max(0, Math.round(word.bbox.y1)) },
      })).filter((word) => word.text.length > 0),
    }))
    .filter((line) => line.text.length > 0 && line.confidence >= 20)
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

export function recognizeScreenshotText(png: Buffer, maxLines = 40) {
  return serialize(async () => {
    const startedAt = performance.now();
    const languages = parseLanguages();
    const workerStartedAt = performance.now();
    const worker = await getWorker(languages);
    const initializationMs = Math.round(performance.now() - workerStartedAt);
    const recognitionStartedAt = performance.now();
    const { data } = await worker.recognize(png, {}, { blocks: true });
    const recognitionMs = Math.round(performance.now() - recognitionStartedAt);
    return {
      engine: "tesseract.js",
      language: languages.join("+"),
      initializationMs,
      recognitionMs,
      latencyMs: Math.round(performance.now() - startedAt),
      lines: formatOcrLines(data.blocks, maxLines),
    };
  });
}

export async function closeOcrWorker() {
  await recognitionQueue;
  const promise = workerPromise;
  workerPromise = undefined;
  workerLanguage = "";
  if (promise) await promise.then((worker) => worker.terminate(), () => undefined);
}
