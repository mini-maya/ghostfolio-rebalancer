import type { ColorScheme } from './allocation-donut-chart.types';

/**
 * Anchor colors (HSL) the palette is interpolated through, roughly
 * matching a dark navy → blue → purple → pink → orange → gold gradient.
 */
const PALETTE_ANCHORS_LIGHT_HSL: [number, number, number][] = [
  [200, 70, 20],
  [219, 45, 40],
  [265, 45, 45],
  [320, 60, 55],
  [10, 80, 60],
  [40, 90, 55]
];

/**
 * Same hues as the light palette, but lighter and slightly less saturated
 * so segments stay legible against a near-black dark-mode background.
 */
const PALETTE_ANCHORS_DARK_HSL: [number, number, number][] = [
  [200, 60, 40],
  [219, 50, 55],
  [265, 50, 60],
  [320, 55, 65],
  [10, 70, 65],
  [40, 80, 62]
];

export function generateDonutPalette(
  count: number,
  colorScheme: ColorScheme = 'LIGHT'
): string[] {
  if (count <= 0) {
    return [];
  }

  const anchors =
    colorScheme === 'DARK' ? PALETTE_ANCHORS_DARK_HSL : PALETTE_ANCHORS_LIGHT_HSL;

  if (count === 1) {
    return [hslToCss(anchors[0])];
  }

  const colors: string[] = [];

  for (let index = 0; index < count; index++) {
    const position = (index / (count - 1)) * (anchors.length - 1);
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.min(lowerIndex + 1, anchors.length - 1);
    const fraction = position - lowerIndex;

    colors.push(hslToCss(interpolateHsl(anchors[lowerIndex], anchors[upperIndex], fraction)));
  }

  return colors;
}

function interpolateHsl(
  from: [number, number, number],
  to: [number, number, number],
  fraction: number
): [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * fraction,
    from[1] + (to[1] - from[1]) * fraction,
    from[2] + (to[2] - from[2]) * fraction
  ];
}

function hslToCss([hue, saturation, lightness]: [number, number, number]): string {
  return `hsl(${hue.toFixed(1)}, ${saturation.toFixed(1)}%, ${lightness.toFixed(1)}%)`;
}

export function readCssVariable(element: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(name).trim();

  return value || fallback;
}

export function getDonutBorderColor(colorScheme: ColorScheme): string {
  return colorScheme === 'DARK' ? '#191c1c' : '#ffffff';
}

export function formatDonutValue(value: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      style: 'currency'
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function formatDonutPercentage(value: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(value)}%`;
}

/**
 * Wraps `text` to at most `maxLines` lines that each fit within `maxWidth`
 * (using `font` for measurement). If the text does not fit, the last line
 * is truncated and suffixed with an ellipsis ("...").
 */
export function wrapCenterLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  font: string
): string[] {
  ctx.save();
  ctx.font = font;

  const words = text.split(/\s+/).filter(Boolean);
  const allLines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (currentLine && ctx.measureText(candidate).width > maxWidth) {
      allLines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  }

  if (currentLine) {
    allLines.push(currentLine);
  }

  if (allLines.length <= maxLines) {
    ctx.restore();

    return allLines;
  }

  const truncatedLines = allLines.slice(0, maxLines);
  let lastLine = truncatedLines[maxLines - 1];

  while (lastLine.length > 0 && ctx.measureText(`${lastLine}...`).width > maxWidth) {
    lastLine = lastLine.slice(0, -1).trimEnd();
  }

  truncatedLines[maxLines - 1] = `${lastLine}...`;

  ctx.restore();

  return truncatedLines;
}
