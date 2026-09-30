import { describe, expect, it } from "vitest";
import { summarizeConfidenceReliability } from "../benchmarks/decision-metrics.mjs";

describe("confidence reliability metrics", () => {
  it("groups by source and calibration, bins confidence, and excludes score outcomes", () => {
    const report = summarizeConfidenceReliability([
      { correct: true, confidence: 0.84, confidenceSource: "maximum-probability", calibration: "uncalibrated-estimate" },
      { correct: false, confidence: 0.74, confidenceSource: "maximum-probability", calibration: "uncalibrated-estimate" },
      { correct: true, confidence: 1, confidenceSource: "provider-reported", calibration: "provider-calibrated" },
      { confidence: 0.99, confidenceSource: "maximum-probability", calibration: "uncalibrated-estimate" },
      { correct: null, confidence: 0.99, confidenceSource: "maximum-probability", calibration: "uncalibrated-estimate" },
      { correct: true, confidence: Number.NaN, confidenceSource: "maximum-probability", calibration: "uncalibrated-estimate" },
      { correct: true, confidence: Number.POSITIVE_INFINITY, confidenceSource: "maximum-probability", calibration: "uncalibrated-estimate" },
    ]);

    expect(report).toHaveLength(2);
    const local = report.find((group) => group.confidenceSource === "maximum-probability");
    expect(local?.calibration).toBe("uncalibrated-estimate");
    expect(local?.sampleCount).toBe(2);
    expect(local?.bins).toHaveLength(10);
    expect(local?.bins[7]).toMatchObject({ sampleCount: 1, meanConfidence: 0.74, accuracy: 0 });
    expect(local?.bins[8]).toMatchObject({ sampleCount: 1, meanConfidence: 0.84, accuracy: 1 });
    expect(local?.expectedCalibrationError).toBeCloseTo(0.45);
    const provider = report.find((group) => group.confidenceSource === "provider-reported");
    expect(provider?.bins[9]).toMatchObject({ sampleCount: 1, meanConfidence: 1, accuracy: 1 });
    expect(provider?.expectedCalibrationError).toBe(0);
  });

  it("returns no reliability groups when no labeled confidence values exist", () => {
    expect(summarizeConfidenceReliability([{ correct: true, confidence: null }])).toEqual([]);
  });
});
