import type { ElementRef } from '@angular/core';
import type {
  Chart as ChartInstance,
  ChartData,
  ChartOptions,
  ChartType,
  ControllerDatasetOptions,
  Plugin,
  Point,
  ScaleOptions,
  Tick,
  TooltipItem,
  TooltipOptions,
  TooltipPosition
} from 'chart.js';
import { Chart, Tooltip } from 'chart.js';
import type { AnnotationOptions } from 'chartjs-plugin-annotation';
import annotationPlugin from 'chartjs-plugin-annotation';
import { format, isMatch, parse, parseISO } from 'date-fns';
import { de } from 'date-fns/locale/de';
import { enUS } from 'date-fns/locale/en-US';

import type { ColorScheme, GroupBy } from './investment-chart.types';

declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType> {
    verticalHoverLine: TType extends 'line' | 'bar'
      ? { color?: string; width?: number }
      : never;
  }
}

export const primaryColorRgb = {
  b: 204,
  g: 207,
  r: 54
};

export const secondaryColorRgb = {
  b: 207,
  g: 134,
  r: 54
};

export const DATE_FORMAT = 'yyyy-MM-dd';
export const DATE_FORMAT_MONTHLY = 'MMMM yyyy';
export const DATE_FORMAT_YEARLY = 'yyyy';

export function getLocale() {
  return globalThis.navigator?.language ?? 'en-US';
}

function getDateFnsLocale(localeString?: string) {
  if (!localeString) {
    return undefined;
  }

  const lang = localeString.split('-')[0].toLowerCase();

  switch (lang) {
    case 'de':
      return de;
    case 'en':
    default:
      return enUS;
  }
}

function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    CHF: 'CHF',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    USD: '$'
  };

  return symbols[currency.toUpperCase()] ?? currency;
}

export function parseDate(date: string): Date | undefined {
  if (!date) {
    return undefined;
  }

  if (date.length === 8) {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(date);

    if (match) {
      const [, year, month, day] = match;
      date = `${year}-${month}-${day}`;
    }
  }

  const dateFormat = [
    'dd-MM-yyyy',
    'dd/MM/yyyy',
    'dd.MM.yyyy',
    'yyyy-MM-dd',
    'yyyy/MM/dd',
    'yyyy.MM.dd',
    'yyyyMMdd'
  ].find((formatString) => {
    return isMatch(date, formatString) && formatString.length === date.length;
  });

  if (dateFormat) {
    return parse(date, dateFormat, new Date());
  }

  return parseISO(date);
}

function getCssVariable(variableName: string, fallbackValue: string) {
  if (typeof document === 'undefined') {
    return fallbackValue;
  }

  return (
    getComputedStyle(document.documentElement).getPropertyValue(variableName).trim() ||
    fallbackValue
  );
}

function getBackgroundColor(colorScheme: ColorScheme) {
  return getCssVariable(
    colorScheme === 'DARK' ? '--dark-background' : '--light-background',
    colorScheme === 'DARK' ? '#0f172a' : '#ffffff'
  );
}

function getTextColor(colorScheme: ColorScheme) {
  return getCssVariable(
    colorScheme === 'DARK' ? '--light-primary-text' : '--dark-primary-text',
    colorScheme === 'DARK' ? '#f8fafc' : '#111827'
  );
}

function formatGroupedDate({
  date,
  groupBy
}: {
  date: number;
  groupBy: GroupBy;
}) {
  if (groupBy === 'month') {
    return format(date, DATE_FORMAT_MONTHLY);
  } else if (groupBy === 'year') {
    return format(date, DATE_FORMAT_YEARLY);
  }

  return format(date, DATE_FORMAT);
}

export function getChartBorderColor(colorScheme: ColorScheme) {
  return colorScheme === 'DARK'
    ? 'rgba(255, 255, 255, 0.1)'
    : 'rgba(15, 23, 42, 0.1)';
}

export function getChartElementsOptions(
  colorScheme: ColorScheme
): ChartOptions<'bar' | 'line'>['elements'] {
  return {
    line: {
      tension: 0
    },
    point: {
      hoverBackgroundColor: getBackgroundColor(colorScheme),
      hoverRadius: 2,
      radius: 0
    }
  };
}

export function getTimeAxisOptions({
  borderWidth = 1,
  colorScheme,
  display = true,
  locale = getLocale()
}: {
  borderWidth?: number;
  colorScheme: ColorScheme;
  display?: boolean;
  locale?: string;
}): ScaleOptions<'time'> {
  return {
    border: {
      color: getChartBorderColor(colorScheme),
      width: borderWidth
    },
    display,
    grid: {
      display: false
    },
    ticks: {
      callback: (value) => {
        const date = new Date(value as number);
        const isJanuary = date.getMonth() === 0;

        if (isJanuary) {
          return format(date, 'MMM yyyy', { locale: getDateFnsLocale(locale) });
        }

        return format(date, 'MMM', { locale: getDateFnsLocale(locale) });
      }
    },
    time: {
      displayFormats: {
        month: 'MMM'
      },
      tooltipFormat: getDateFormatString(locale),
      unit: 'month'
    },
    type: 'time'
  };
}

export function getTooltipOptions<T extends ChartType>({
  colorScheme,
  currency = '',
  groupBy,
  locale = getLocale(),
  unit = ''
}: {
  colorScheme: ColorScheme;
  currency?: string;
  groupBy?: GroupBy;
  locale?: string;
  unit?: string;
}): any {
  return {
    backgroundColor: getBackgroundColor(colorScheme),
    bodyColor: getTextColor(colorScheme),
    borderColor: getChartBorderColor(colorScheme),
    borderWidth: 1,
    callbacks: {
      label: (context: TooltipItem<T>) => {
        let label = (context.dataset as ControllerDatasetOptions).label ?? '';

        if (label) {
          label += ': ';
        }

        const yPoint = (context.parsed as Point).y;

        if (yPoint !== null) {
          if (currency) {
            const currencySymbol = getCurrencySymbol(currency);
            label += `${yPoint.toLocaleString(locale, {
              maximumFractionDigits: 2,
              minimumFractionDigits: 2
            })} ${currencySymbol}`;
          } else if (unit) {
            label += `${yPoint.toFixed(2)} ${unit}`;
          } else {
            label += yPoint.toFixed(2);
          }
        }

        return label;
      },
      title: (contexts: TooltipItem<T>[]) => {
        const xPoint = (contexts[0].parsed as Point).x;

        if (groupBy && xPoint !== null) {
          return formatGroupedDate({ groupBy, date: xPoint });
        }

        return contexts[0].label;
      }
    } as any,
    caretSize: 0,
    cornerRadius: 2,
    footerColor: getTextColor(colorScheme),
    itemSort: (a: TooltipItem<T>, b: TooltipItem<T>) => {
      return b.datasetIndex - a.datasetIndex;
    },
    titleColor: getTextColor(colorScheme),
    usePointStyle: true
  } as unknown as Partial<TooltipOptions<T>>;
}

export function getValueAxisOptions({
  colorScheme,
  display = true,
  tickCallback
}: {
  colorScheme: ColorScheme;
  display?: boolean;
  tickCallback: (
    tickValue: number | string,
    index: number,
    ticks: Tick[]
  ) => string;
}): ScaleOptions<'linear'> {
  return {
    border: {
      display: false
    },
    display,
    grid: {
      color: ({ scale, tick }) => {
        if (
          tick.value === 0 ||
          tick.value === scale.max ||
          tick.value === scale.min
        ) {
          return getChartBorderColor(colorScheme);
        }

        return 'transparent';
      }
    },
    position: 'right',
    ticks: {
      callback: tickCallback,
      display,
      mirror: true,
      z: 1
    }
  };
}

export function getVerticalHoverLinePlugin<T extends 'line' | 'bar'>(
  chartCanvas: ElementRef<HTMLCanvasElement>,
  colorScheme: ColorScheme
): Plugin<T, { color: string; width: number }> {
  return {
    afterDatasetsDraw: (chart, _, options) => {
      const active = chart.getActiveElements();

      if (!active || active.length === 0) {
        return;
      }

      const color = options.color ?? getTextColor(colorScheme);
      const width = options.width ?? 1;

      const {
        chartArea: { bottom, top }
      } = chart;
      const xValue = active[0].element.x;

      const context = chartCanvas.nativeElement.getContext('2d');

      if (context) {
        context.lineWidth = width;
        context.strokeStyle = color;

        context.beginPath();
        context.moveTo(xValue, top);
        context.lineTo(xValue, bottom);
        context.stroke();
      }
    },
    id: 'verticalHoverLine'
  };
}

export function getZeroLineAnnotation(
  colorScheme: ColorScheme
): AnnotationOptions<'line'> {
  return {
    borderColor: getChartBorderColor(colorScheme),
    borderWidth: 1,
    scaleID: 'y',
    type: 'line',
    value: 0
  };
}

export function transformTickToAbbreviation(value: number) {
  if (value === 0) {
    return '0';
  } else if (value >= -999 && value <= 999) {
    return value.toFixed(2);
  } else if (value >= -999999 && value <= 999999) {
    return `${value / 1000}K`;
  }

  return `${value / 1000000}M`;
}

export function getTimeSeriesTooltipOptions<T extends 'bar' | 'line'>({
  colorScheme,
  currency,
  groupBy,
  locale,
  unit
}: {
  colorScheme: ColorScheme;
  currency?: string;
  groupBy?: GroupBy;
  locale?: string;
  unit?: string;
}): any {
  return {
    ...getTooltipOptions<T>({ colorScheme, currency, groupBy, locale, unit }),
    mode: 'index',
    position: 'top' as unknown as TooltipOptions<T>['position'],
    xAlign: 'center',
    yAlign: 'bottom'
  } as Partial<TooltipOptions<T>>;
}

export function registerChartConfiguration() {
  const tooltipPositioners = Tooltip.positioners as unknown as Record<string, unknown>;

  if (tooltipPositioners['top']) {
    return;
  }

  Chart.register(annotationPlugin);

  tooltipPositioners['top'] = function (_elements: unknown, eventPosition: TooltipPosition) {
    const chartContext = this as { chart?: ChartInstance };

    return getTooltipPositionerMapTop(chartContext.chart as ChartInstance, eventPosition);
  };
}

export function getTooltipPositionerMapTop(
  chart: ChartInstance,
  position: TooltipPosition
) {
  if (!position || !chart?.chartArea) {
    return false;
  }

  return {
    x: position.x,
    y: chart.chartArea.top
  };
}

function getDateFormatString(locale?: string) {
  const formatObject = new Intl.DateTimeFormat(locale).formatToParts(new Date());

  return formatObject
    .map(({ type, value }) => {
      switch (type) {
        case 'day':
          return 'dd';
        case 'month':
          return 'MM';
        case 'year':
          return 'yyyy';
        default:
          return value;
      }
    })
    .join('');
}
