import { describe, expect, it } from "vitest";
import { findExactOcrTextMatches, formatOcrLines } from "../src/browser/ocr.js";

describe("bounded local OCR output", () => {
  it("sorts visible lines, bounds text and boxes, and drops low-confidence noise", () => {
    const lines = formatOcrLines([{ paragraphs: [{ lines: [
      { text: "Second row", confidence: 91.2, bbox: { x0: 30.4, y0: 80.2, x1: 130.7, y1: 99.9 } },
      { text: "   ", confidence: 99, bbox: { x0: 0, y0: 0, x1: 2, y1: 2 } },
      { text: "Unreadable", confidence: 18, bbox: { x0: 0, y0: 10, x1: 40, y1: 20 } },
      { text: "First row", confidence: 94.8, bbox: { x0: 10.4, y0: 20.2, x1: 110.7, y1: 39.9 }, words: [
        { text: "First", confidence: 92, bbox: { x0: 10.4, y0: 20.2, x1: 50.7, y1: 39.9 } },
        { text: "row", confidence: 94, bbox: { x0: 55.4, y0: 20.2, x1: 110.7, y1: 39.9 } },
      ] },
    ] }] }], 40);

    expect(lines).toEqual([
      { text: "First row", confidence: 95, box: { x0: 10, y0: 20, x1: 111, y1: 40 }, words: [
        { text: "First", confidence: 92, box: { x0: 10, y0: 20, x1: 51, y1: 40 } },
        { text: "row", confidence: 94, box: { x0: 55, y0: 20, x1: 111, y1: 40 } },
      ] },
      { text: "Second row", confidence: 91, box: { x0: 30, y0: 80, x1: 131, y1: 100 }, words: [] },
    ]);
  });

  it("honors line and total-character bounds", () => {
    const blocks = [{ paragraphs: [{ lines: [
      { text: "A".repeat(500), confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } },
      { text: "second", confidence: 90, bbox: { x0: 0, y0: 30, x1: 100, y1: 50 } },
    ] }] }];

    expect(formatOcrLines(blocks, 1)).toHaveLength(1);
    expect(formatOcrLines(blocks, 1)[0]?.text).toHaveLength(240);
    expect(() => formatOcrLines(blocks, 81)).toThrow("maxLines");
  });

  it("bounds the aggregate word-box detail", () => {
    const words = Array.from({ length: 80 }, (_, index) => ({ text: `word${index}`, confidence: 90, bbox: { x0: index, y0: 0, x1: index + 1, y1: 10 } }));
    const blocks = [{ paragraphs: [{ lines: Array.from({ length: 20 }, (_, index) => ({ text: `Line ${index}`, confidence: 90, bbox: { x0: 0, y0: index * 12, x1: 100, y1: index * 12 + 10 }, words })) }] }];
    const lines = formatOcrLines(blocks, 40);
    const formattedWords = lines.flatMap((line) => line.words);
    expect(formattedWords).toHaveLength(400);
    expect(formattedWords.reduce((total, word) => total + word.text.length, 0)).toBeLessThanOrEqual(6_000);
  });

  it("matches exact OCR word sequences, bounds the target, and preserves duplicates as ambiguous", () => {
    const lines = formatOcrLines([{ paragraphs: [{ lines: [
      { text: "Save draft", confidence: 92, bbox: { x0: 20, y0: 30, x1: 150, y1: 60 }, words: [
        { text: "Save", confidence: 90, bbox: { x0: 20, y0: 30, x1: 75, y1: 60 } },
        { text: "draft", confidence: 92, bbox: { x0: 82, y0: 30, x1: 150, y1: 60 } },
      ] },
      { text: "Save draft", confidence: 88, bbox: { x0: 20, y0: 80, x1: 150, y1: 110 }, words: [
        { text: "Save", confidence: 88, bbox: { x0: 20, y0: 80, x1: 75, y1: 110 } },
        { text: "draft", confidence: 91, bbox: { x0: 82, y0: 80, x1: 150, y1: 110 } },
      ] },
      { text: "Save this draft", confidence: 98, bbox: { x0: 20, y0: 130, x1: 180, y1: 160 }, words: [
        { text: "Save", confidence: 98, bbox: { x0: 20, y0: 130, x1: 65, y1: 160 } },
        { text: "this", confidence: 98, bbox: { x0: 70, y0: 130, x1: 100, y1: 160 } },
        { text: "draft", confidence: 98, bbox: { x0: 105, y0: 130, x1: 180, y1: 160 } },
      ] },
    ] }] }]);

    const matches = findExactOcrTextMatches(lines, "SAVE, draft!");
    expect(matches).toHaveLength(2);
    expect(matches[0]?.box).toEqual({ x0: 20, y0: 30, x1: 150, y1: 60 });
    expect(findExactOcrTextMatches(lines, "Save this draft")).toHaveLength(1);
    expect(findExactOcrTextMatches(lines, "Save something")).toHaveLength(0);
    expect(findExactOcrTextMatches(lines, " ")).toHaveLength(0);
  });
});
