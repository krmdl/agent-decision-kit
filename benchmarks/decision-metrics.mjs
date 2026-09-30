export function summarizeConfidenceReliability(records) {
  const groups = new Map();
  for (const record of records) {
    if (typeof record.correct !== "boolean" || typeof record.confidence !== "number" || !Number.isFinite(record.confidence)) continue;
    const source = record.confidenceSource ?? "unavailable";
    const calibration = record.calibration ?? "unavailable";
    const key = `${source}\u0000${calibration}`;
    if (!groups.has(key)) {
      groups.set(key, { confidenceSource: source, calibration, bins: Array.from({ length: 10 }, (_, index) => ({
        lowerBound: index / 10,
        upperBound: (index + 1) / 10,
        sampleCount: 0,
        confidenceSum: 0,
        correctCount: 0,
      })) });
    }
    const group = groups.get(key);
    const confidence = Math.max(0, Math.min(1, record.confidence));
    const bin = group.bins[Math.min(9, Math.floor(confidence * 10))];
    bin.sampleCount += 1;
    bin.confidenceSum += confidence;
    bin.correctCount += Number(record.correct);
  }

  return [...groups.values()].map((group) => {
    const sampleCount = group.bins.reduce((sum, bin) => sum + bin.sampleCount, 0);
    let weightedCalibrationError = 0;
    const bins = group.bins.map((bin) => {
      if (bin.sampleCount === 0) {
        return { lowerBound: bin.lowerBound, upperBound: bin.upperBound, sampleCount: 0, meanConfidence: null, accuracy: null };
      }
      const meanConfidence = bin.confidenceSum / bin.sampleCount;
      const accuracy = bin.correctCount / bin.sampleCount;
      weightedCalibrationError += (bin.sampleCount / sampleCount) * Math.abs(meanConfidence - accuracy);
      return { lowerBound: bin.lowerBound, upperBound: bin.upperBound, sampleCount: bin.sampleCount, meanConfidence, accuracy };
    });
    return {
      confidenceSource: group.confidenceSource,
      calibration: group.calibration,
      outcome: "predicted choice/yes-no correctness",
      sampleCount,
      expectedCalibrationError: weightedCalibrationError,
      bins,
    };
  });
}
