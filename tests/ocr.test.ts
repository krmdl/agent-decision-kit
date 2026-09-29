import { describe, expect, it } from "vitest";
import { formatOcrLines } from "../src/browser/ocr.js";

describe("bounded local OCR output", () => {
  it("sorts visible lines, bounds text and boxes, and drops low-confidence noise", () => {
    const lines = formatOcrLines([{ paragraphs: [{ lines: [
      { text: "Second row", confidence: 91.2, bbox: { x0: 30.4, y0: 80.2, x1: 130.7, y1: 99.9 } },
      { text: "   ", confidence: 99, bbox: { x0: 0, y0: 0, x1: 2, y1: 2 } },
      { text: "Unreadable", confidence: 18, bbox: { x0: 0, y0: 10, x1: 40, y1: 20 } },
      { text: "First row", confidence: 94.8, bbox: { x0: 10.4, y0: 20.2, x1: 110.7, y1: 39.9 } },
    ] }] }], 40);

    expect(lines).toEqual([
      { text: "First row", confidence: 95, box: { x0: 10, y0: 20, x1: 111, y1: 40 } },
      { text: "Second row", confidence: 91, box: { x0: 30, y0: 80, x1: 131, y1: 100 } },
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
});
