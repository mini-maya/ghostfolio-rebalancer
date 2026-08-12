export interface AllocationItem {
  percentage: number;
  symbol: string;
}

export interface AllocationState {
  errors: string[];
  items: AllocationItem[];
  total: number;
}

export function parseAllocationsText(allocationsText: string): AllocationState {
  const errors: string[] = [];
  const items: AllocationItem[] = [];
  let total = 0;

  for (const [index, rawEntry] of allocationsText.split('|').entries()) {
    const entry = rawEntry.trim();

    if (!entry) {
      continue;
    }

    const [symbol, percentageText, ...rest] = entry.split(',').map((value) => value.trim());

    if (!symbol || !percentageText || rest.length > 0) {
      errors.push(`Entry ${index + 1} must use "SYMBOL,PERCENT|SYMBOL,PERCENT".`);
      continue;
    }

    const percentage = Number(percentageText);

    if (!Number.isFinite(percentage) || percentage < 0) {
      errors.push(`Entry ${index + 1} has an invalid percentage.`);
      continue;
    }

    items.push({ percentage, symbol });
    total += percentage;
  }

  return {
    errors,
    items,
    total: roundToTwo(total)
  };
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
