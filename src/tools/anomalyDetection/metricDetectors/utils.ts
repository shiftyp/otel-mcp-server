/**
 * Calculate statistical measures for an array of values
 * @param values Array of numeric values
 * @returns Object containing statistical measures
 */
export function calculateStatistics(values: number[]): any {
  if (values.length === 0) {
    return { count: 0 };
  }

  // Sort values for percentile calculations
  const sortedValues = [...values].sort((a, b) => a - b);
  const count = values.length;

  // Calculate mean
  const sum = values.reduce((acc, val) => acc + val, 0);
  const mean = sum / count;

  // Calculate variance and standard deviation
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / count;
  const stdDev = Math.sqrt(variance);

  // Calculate quartiles and IQR
  const q1Index = Math.floor(count * 0.25);
  const q3Index = Math.floor(count * 0.75);
  const q1 = sortedValues[q1Index];
  const q3 = sortedValues[q3Index];
  const iqr = q3 - q1;
  const median = count % 2 === 0 
    ? (sortedValues[count / 2 - 1] + sortedValues[count / 2]) / 2 
    : sortedValues[Math.floor(count / 2)];

  // Calculate min, max
  const min = sortedValues[0];
  const max = sortedValues[count - 1];

  // Calculate percentiles
  const percentiles: Record<string, number> = {};
  [90, 95, 99].forEach(p => {
    const index = Math.floor(count * (p / 100));
    percentiles[`p${p}`] = sortedValues[index];
  });

  return {
    count,
    min,
    max,
    mean,
    median,
    variance,
    stdDev,
    q1,
    q3,
    iqr,
    ...percentiles
  };
}
