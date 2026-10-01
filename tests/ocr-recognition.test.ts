import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createWorkerMock } = vi.hoisted(() => ({ createWorkerMock: vi.fn() }));

vi.mock("tesseract.js", () => ({
  createWorker: createWorkerMock,
  PSM: { AUTO: "3", SINGLE_BLOCK: "6", SINGLE_CHAR: "10", SPARSE_TEXT: "11" },
}));

import { closeOcrWorker, recognizeScreenshotText } from "../src/browser/ocr.js";

describe("digit OCR duplicate refinement", () => {
  const worker = {
    setParameters: vi.fn(async () => undefined),
    recognize: vi.fn(),
    terminate: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createWorkerMock.mockResolvedValue(worker);
  });

  afterEach(async () => {
    await closeOcrWorker();
  });

  it("rechecks duplicate glyphs as single characters and updates isolated line text", async () => {
    worker.recognize
      .mockResolvedValueOnce({ data: { blocks: [digitBlock("4", 20, 20), digitBlock("4", 80, 60)] } })
      .mockResolvedValueOnce({ data: { blocks: [digitBlock("4", 20, 20)] } })
      .mockResolvedValueOnce({ data: { blocks: [digitBlock("1", 80, 60)] } });

    const result = await recognizeScreenshotText(Buffer.from("synthetic png"), 40, "automatic", "digits", { width: 120, height: 100 });

    expect(result.symbolRetryCount).toBe(2);
    expect(result.lines.map(({ text, words }) => ({ text, words: words.map((word) => word.text) }))).toEqual([
      { text: "4", words: ["4"] },
      { text: "1", words: ["1"] },
    ]);
    expect(worker.setParameters).toHaveBeenLastCalledWith({
      tessedit_pageseg_mode: "10",
      tessedit_char_whitelist: "0123456789",
      classify_bln_numeric_mode: "1",
    });
  });
});

function digitBlock(text: string, x: number, y: number) {
  const box = { x0: x, y0: y, x1: x + 8, y1: y + 15 };
  return {
    paragraphs: [{
      lines: [{
        text,
        confidence: 90,
        bbox: box,
        words: [{ text, confidence: 90, bbox: box, symbols: [{ text, confidence: 90, bbox: box }] }],
      }],
    }],
  };
}
