import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  signal,
  viewChild
} from '@angular/core';
import {
  BarController,
  BarElement,
  Chart,
  ChartData,
  type ChartDataset,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  type ScriptableLineSegmentContext,
  TimeScale,
  Tooltip
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { type AnnotationOptions } from 'chartjs-plugin-annotation';
import { addMonths, addYears, endOfYear, isFuture, startOfYear, sub } from 'date-fns';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';
import { EventEmitter } from '@angular/core';

import {
  getChartBorderColor,
  getChartElementsOptions,
  getTimeAxisOptions,
  getTimeSeriesTooltipOptions,
  getValueAxisOptions,
  getVerticalHoverLinePlugin,
  getZeroLineAnnotation,
  primaryColorRgb,
  registerChartConfiguration,
  secondaryColorRgb,
  transformTickToAbbreviation,
  getLocale,
  parseDate
} from './investment-chart.helpers';
import type { InvestmentItem, LineChartItem } from './investment-chart.interfaces';
import type { ColorScheme, GroupBy, TimeRange } from './investment-chart.types';

type AxisId = 'yPrimary' | 'ySecondary';

interface AxisAssignment {
  benchmarkAxisId: AxisId;
  historicalAxisId: AxisId;
  shouldUseSecondaryAxis: boolean;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgxSkeletonLoaderModule],
  selector: 'gf-investment-chart',
  standalone: true,
  styleUrls: ['./investment-chart.component.scss'],
  templateUrl: './investment-chart.component.html'
})
export class GfInvestmentChartComponent implements OnChanges, OnDestroy {
  @Input() benchmarkDataItems: InvestmentItem[] = [];
  @Input() benchmarkDataLabel = '';
  @Input() benchmarkDisplayType: 'bar' | 'line' = 'line';
  @Input() benchmarkStepped = true;
  @Input() colorScheme: ColorScheme = 'LIGHT';
  @Input() currency = 'USD';
  @Input() groupBy?: GroupBy;
  @Input() historicalDataItems: LineChartItem[] = [];
  @Input() historicalDataLabel = 'Total Amount';
  @Input() historicalDisplayType: 'bar' | 'line' = 'line';
  @Input() isInPercentage = false;
  @Input() isLoading = false;
  @Input() locale = getLocale();
  @Input() savingsRate = 0;
  @Input() timeRangeMode: 'leading' | 'trailing' = 'trailing';
  @Input() timeRange: TimeRange = 'MAX';

  @Output() timeRangeChange = new EventEmitter<TimeRange>();

  readonly selectedTimeRange = signal<TimeRange>('MAX');
  readonly timeRangeOptions: { label: string; value: TimeRange }[] = [
    { label: '1M', value: '1M' },
    { label: '3M', value: '3M' },
    { label: '6M', value: '6M' },
    { label: '1J', value: '1J' },
    { label: '3J', value: '3J' },
    { label: '5J', value: '5J' },
    { label: 'YTD', value: 'YTD' },
    { label: 'MAX', value: 'MAX' }
  ];

  private readonly chartCanvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('chartCanvas');

  private chart: Chart<'bar' | 'line'> | undefined;
  private investments: InvestmentItem[] = [];
  private values: LineChartItem[] = [];

  public constructor() {
    Chart.register(
      BarController,
      BarElement,
      LinearScale,
      LineController,
      LineElement,
      PointElement,
      TimeScale,
      Tooltip
    );

    registerChartConfiguration();
  }

  public ngOnChanges() {
    this.selectedTimeRange.set(this.timeRange);
    if (this.benchmarkDataItems && this.historicalDataItems) {
      this.initialize();
    }
  }

  public ngOnDestroy() {
    this.chart?.destroy();
  }

  public selectTimeRange(range: TimeRange): void {
    this.selectedTimeRange.set(range);
    this.timeRangeChange.emit(range);
    this.initialize();
  }

  private getRangeBoundaryDate(range: TimeRange, dates: Date[]): Date | null {
    const anchorDate = this.getRangeAnchorDate(dates);

    if (!anchorDate) {
      return null;
    }

    switch (range) {
      case '1M':
        return this.timeRangeMode === 'leading'
          ? addMonths(anchorDate, 1)
          : sub(anchorDate, { months: 1 });
      case '3M':
        return this.timeRangeMode === 'leading'
          ? addMonths(anchorDate, 3)
          : sub(anchorDate, { months: 3 });
      case '6M':
        return this.timeRangeMode === 'leading'
          ? addMonths(anchorDate, 6)
          : sub(anchorDate, { months: 6 });
      case '1J':
        return this.timeRangeMode === 'leading'
          ? addYears(anchorDate, 1)
          : sub(anchorDate, { years: 1 });
      case '3J':
        return this.timeRangeMode === 'leading'
          ? addYears(anchorDate, 3)
          : sub(anchorDate, { years: 3 });
      case '5J':
        return this.timeRangeMode === 'leading'
          ? addYears(anchorDate, 5)
          : sub(anchorDate, { years: 5 });
      case 'YTD':
        return this.timeRangeMode === 'leading' ? endOfYear(anchorDate) : startOfYear(anchorDate);
      case 'MAX':
      default:
        return null;
    }
  }

  private getFilteredData<T extends { date: string }>(data: T[]): T[] {
    const dates = data
      .map((item) => parseDate(item.date))
      .filter((itemDate): itemDate is Date => Boolean(itemDate));
    const boundaryDate = this.getRangeBoundaryDate(this.selectedTimeRange(), dates);

    if (!boundaryDate) {
      return data;
    }

    return data.filter((item) => {
      const itemDate = parseDate(item.date);

      if (!itemDate) {
        return false;
      }

      return this.timeRangeMode === 'leading'
        ? itemDate <= boundaryDate
        : itemDate >= boundaryDate;
    });
  }

  private getRangeAnchorDate(dates: Date[]): Date | null {
    if (!dates.length) {
      return null;
    }

    if (this.timeRangeMode === 'leading') {
      return dates.reduce((earliest, current) => {
        return current < earliest ? current : earliest;
      });
    }

    return new Date();
  }

  private initialize() {
    const filteredBenchmarkItems = this.getFilteredData(this.benchmarkDataItems);
    const filteredHistoricalItems = this.getFilteredData(this.historicalDataItems);
    const axisAssignment = getAxisAssignment({
      benchmarkDataItems: filteredBenchmarkItems,
      historicalDataItems: filteredHistoricalItems
    });

    this.investments = filteredBenchmarkItems.map((item) => ({...item}));
    this.values = filteredHistoricalItems.map((item) => ({...item}));

    const chartData: ChartData<'bar' | 'line'> = {
      labels: filteredHistoricalItems.map(({ date }) => {
        return parseDate(date);
      }),
      datasets: [
        {
          type: this.benchmarkDisplayType,
          backgroundColor:
            this.benchmarkDisplayType === 'bar'
              ? `rgba(${secondaryColorRgb.r}, ${secondaryColorRgb.g}, ${secondaryColorRgb.b}, 0.35)`
              : `rgb(${secondaryColorRgb.r}, ${secondaryColorRgb.g}, ${secondaryColorRgb.b})`,
          borderColor: `rgb(${secondaryColorRgb.r}, ${secondaryColorRgb.g}, ${secondaryColorRgb.b})`,
          borderWidth: this.benchmarkDisplayType === 'bar' ? 0 : 1,
          data: this.investments.map(({ date, investment }) => {
            return {
              x: parseDate(date)?.getTime() ?? null,
              y: this.isInPercentage ? investment * 100 : investment
            };
          }),
          label: this.benchmarkDataLabel,
          yAxisID: axisAssignment.benchmarkAxisId,
          segment:
            this.benchmarkDisplayType === 'line'
              ? {
                  borderColor: (ctx: ScriptableLineSegmentContext) =>
                    this.isInFuture(
                      ctx,
                      `rgba(${secondaryColorRgb.r}, ${secondaryColorRgb.g}, ${secondaryColorRgb.b}, 0.67)`
                    ),
                  borderDash: (ctx: ScriptableLineSegmentContext) =>
                    this.isInFuture(ctx, [2, 2])
                }
              : undefined,
          stepped: this.benchmarkDisplayType === 'line' ? this.benchmarkStepped : false
        } as ChartDataset<'bar' | 'line'>,
        {
          type: this.historicalDisplayType,
          backgroundColor:
            this.historicalDisplayType === 'bar'
              ? `rgba(${primaryColorRgb.r}, ${primaryColorRgb.g}, ${primaryColorRgb.b}, 0.35)`
              : undefined,
          borderColor: `rgb(${primaryColorRgb.r}, ${primaryColorRgb.g}, ${primaryColorRgb.b})`,
          borderWidth: this.historicalDisplayType === 'bar' ? 0 : 2,
          data: this.values.map(({ date, value }) => {
            return {
              x: parseDate(date)?.getTime() ?? null,
              y: this.isInPercentage ? value * 100 : value
            };
          }),
          fill: false,
          label: this.historicalDataLabel,
          pointRadius: this.historicalDisplayType === 'bar' ? 0 : 0,
          yAxisID: axisAssignment.historicalAxisId,
          segment:
            this.historicalDisplayType === 'line'
              ? {
                  borderColor: (ctx: ScriptableLineSegmentContext) =>
                    this.isInFuture(
                      ctx,
                      `rgba(${primaryColorRgb.r}, ${primaryColorRgb.g}, ${primaryColorRgb.b}, 0.67)`
                    ),
                  borderDash: (ctx: ScriptableLineSegmentContext) =>
                    this.isInFuture(ctx, [2, 2])
                }
              : undefined
        } as ChartDataset<'bar' | 'line'>
      ]
    };

    const chartCanvas = this.chartCanvas();

    if (chartCanvas?.nativeElement) {
      if (this.chart) {
        this.chart.data = chartData;
        this.chart.options.scales = this.getChartScales(axisAssignment);
        this.chart.options.plugins ??= {};
        this.chart.options.plugins.tooltip = this.getTooltipPluginConfiguration();

        const annotations = this.chart.options.plugins?.annotation
          ?.annotations as Record<string, AnnotationOptions<'line'>> | undefined;
        if (this.savingsRate && annotations?.['savingsRate']) {
          annotations['savingsRate'].scaleID = axisAssignment.benchmarkAxisId;
          annotations['savingsRate'].value = this.savingsRate;
        }

        this.chart.update();
      } else {
        this.chart = new Chart<'bar' | 'line'>(chartCanvas.nativeElement, {
          data: chartData,
          options: {
            animation: { duration: 1200, easing: 'easeOutQuart' },
            elements: getChartElementsOptions(this.colorScheme),
            interaction: { intersect: false, mode: 'index' },
            maintainAspectRatio: true,
            plugins: {
              annotation: {
                annotations: {
                  savingsRate: this.savingsRate
                    ? {
                        borderColor: `rgba(${primaryColorRgb.r}, ${primaryColorRgb.g}, ${primaryColorRgb.b}, 0.75)`,
                        borderWidth: 1,
                        label: {
                          backgroundColor: `rgb(${primaryColorRgb.r}, ${primaryColorRgb.g}, ${primaryColorRgb.b})`,
                          borderRadius: 2,
                          color: 'white',
                          content: 'Savings Rate',
                          display: true,
                          font: { size: 10, weight: 'normal' },
                          padding: {
                            x: 4,
                            y: 2
                          },
                          position: 'start'
                        },
                        scaleID: axisAssignment.benchmarkAxisId,
                        type: 'line',
                        value: this.savingsRate
                      }
                    : undefined,
                  yAxis: getZeroLineAnnotation(this.colorScheme, axisAssignment.historicalAxisId)
                }
              },
              legend: {
                display: false
              },
              tooltip: this.getTooltipPluginConfiguration(),
              verticalHoverLine: {
                color: getChartBorderColor(this.colorScheme)
              }
            },
            responsive: true,
            scales: this.getChartScales(axisAssignment)
          },
          plugins: [getVerticalHoverLinePlugin(chartCanvas, this.colorScheme)],
          type:
            this.benchmarkDisplayType === 'bar' || this.historicalDisplayType === 'bar'
              ? 'bar'
              : 'line'
        });
      }
    }
  }

  private getChartScales(axisAssignment: AxisAssignment) {
    const tickCallback = (tickValue: number | string) => {
      return transformTickToAbbreviation(Number(tickValue));
    };

    return {
      x: getTimeAxisOptions({
        borderWidth: this.groupBy ? 0 : 1,
        colorScheme: this.colorScheme,
        locale: this.locale
      }),
      yPrimary: getValueAxisOptions({
        colorScheme: this.colorScheme,
        display: !this.isInPercentage,
        position: 'right',
        tickCallback
      }),
      ySecondary: getValueAxisOptions({
        colorScheme: this.colorScheme,
        display: !this.isInPercentage && axisAssignment.shouldUseSecondaryAxis,
        drawGrid: false,
        position: 'left',
        tickCallback
      })
    };
  }

  private getTooltipPluginConfiguration() {
    return getTimeSeriesTooltipOptions<'bar' | 'line'>({
      colorScheme: this.colorScheme,
      currency: this.isInPercentage ? undefined : this.currency,
      groupBy: this.groupBy,
      locale: this.isInPercentage ? undefined : this.locale,
      unit: this.isInPercentage ? '%' : undefined
    });
  }

  private isInFuture<T>(ctx: ScriptableLineSegmentContext, value: T): T | undefined {
    const xValue = ctx?.p1?.parsed?.x;

    if (xValue == null) {
      return undefined;
    }

    return isFuture(new Date(xValue)) ? value : undefined;
  }
}

function getAxisAssignment({
  benchmarkDataItems,
  historicalDataItems
}: {
  benchmarkDataItems: InvestmentItem[];
  historicalDataItems: LineChartItem[];
}): AxisAssignment {
  const benchmarkMax = getSeriesMaxValue(
    benchmarkDataItems.map(({ investment }) => investment)
  );
  const historicalMax = getSeriesMaxValue(
    historicalDataItems.map(({ value }) => Number(value))
  );
  const smallerMax = Math.min(benchmarkMax, historicalMax);
  const largerMax = Math.max(benchmarkMax, historicalMax);
  const shouldUseSecondaryAxis = smallerMax > 0 && largerMax / smallerMax > 10;

  if (!shouldUseSecondaryAxis || benchmarkMax === historicalMax) {
    return {
      benchmarkAxisId: 'yPrimary',
      historicalAxisId: 'yPrimary',
      shouldUseSecondaryAxis
    };
  }

  return benchmarkMax < historicalMax
    ? {
        benchmarkAxisId: 'ySecondary',
        historicalAxisId: 'yPrimary',
        shouldUseSecondaryAxis
      }
    : {
        benchmarkAxisId: 'yPrimary',
        historicalAxisId: 'ySecondary',
        shouldUseSecondaryAxis
      };
}

function getSeriesMaxValue(values: number[]): number {
  return values.reduce((maxValue, value) => {
    const numericValue = Number.isFinite(value) ? Math.abs(value) : 0;

    return numericValue > maxValue ? numericValue : maxValue;
  }, 0);
}
