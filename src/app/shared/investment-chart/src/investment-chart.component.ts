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
import { isFuture, startOfYear, sub } from 'date-fns';
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
  @Input() colorScheme: ColorScheme = 'LIGHT';
  @Input() currency = 'USD';
  @Input() groupBy?: GroupBy;
  @Input() historicalDataItems: LineChartItem[] = [];
  @Input() isInPercentage = false;
  @Input() isLoading = false;
  @Input() locale = getLocale();
  @Input() savingsRate = 0;
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

  private getCutoffDate(range: TimeRange): Date | null {
    const now = new Date();

    switch (range) {
      case '1M':
        return sub(now, { months: 1 });
      case '3M':
        return sub(now, { months: 3 });
      case '6M':
        return sub(now, { months: 6 });
      case '1J':
        return sub(now, { years: 1 });
      case '3J':
        return sub(now, { years: 3 });
      case '5J':
        return sub(now, { years: 5 });
      case 'YTD':
        return startOfYear(now);
      case 'MAX':
      default:
        return null;
    }
  }

  private getFilteredData<T extends { date: string }>(data: T[]): T[] {
    const cutoffDate = this.getCutoffDate(this.selectedTimeRange());

    if (!cutoffDate) {
      return data;
    }

    return data.filter((item) => {
      const itemDate = parseDate(item.date);
      return itemDate && itemDate >= cutoffDate;
    });
  }

  private initialize() {
    const filteredBenchmarkItems = this.getFilteredData(this.benchmarkDataItems);
    const filteredHistoricalItems = this.getFilteredData(this.historicalDataItems);

    this.investments = filteredBenchmarkItems.map((item) => ({...item}));
    this.values = filteredHistoricalItems.map((item) => ({...item}));

    const chartData: ChartData<'bar' | 'line'> = {
      labels: filteredHistoricalItems.map(({ date }) => {
        return parseDate(date);
      }),
      datasets: [
        {
          backgroundColor: `rgb(${secondaryColorRgb.r}, ${secondaryColorRgb.g}, ${secondaryColorRgb.b})`,
          borderColor: `rgb(${secondaryColorRgb.r}, ${secondaryColorRgb.g}, ${secondaryColorRgb.b})`,
          borderWidth: this.groupBy ? 0 : 1,
          data: this.investments.map(({ date, investment }) => {
            return {
              x: parseDate(date)?.getTime() ?? null,
              y: this.isInPercentage ? investment * 100 : investment
            };
          }),
          label: this.benchmarkDataLabel,
          segment: {
            borderColor: (ctx: ScriptableLineSegmentContext) =>
              this.isInFuture(
                ctx,
                `rgba(${secondaryColorRgb.r}, ${secondaryColorRgb.g}, ${secondaryColorRgb.b}, 0.67)`
              ),
            borderDash: (ctx: ScriptableLineSegmentContext) =>
              this.isInFuture(ctx, [2, 2])
          },
          stepped: true
        },
        {
          borderColor: `rgb(${primaryColorRgb.r}, ${primaryColorRgb.g}, ${primaryColorRgb.b})`,
          borderWidth: 2,
          data: this.values.map(({ date, value }) => {
            return {
              x: parseDate(date)?.getTime() ?? null,
              y: this.isInPercentage ? value * 100 : value
            };
          }),
          fill: false,
          label: 'Total Amount',
          pointRadius: 0,
          segment: {
            borderColor: (ctx: ScriptableLineSegmentContext) =>
              this.isInFuture(
                ctx,
                `rgba(${primaryColorRgb.r}, ${primaryColorRgb.g}, ${primaryColorRgb.b}, 0.67)`
              ),
            borderDash: (ctx: ScriptableLineSegmentContext) =>
              this.isInFuture(ctx, [2, 2])
          }
        }
      ]
    };

    const chartCanvas = this.chartCanvas();

    if (chartCanvas?.nativeElement) {
      if (this.chart) {
        this.chart.data = chartData;
        this.chart.options.plugins ??= {};
        this.chart.options.plugins.tooltip = this.getTooltipPluginConfiguration();

        const annotations = this.chart.options.plugins?.annotation
          ?.annotations as Record<string, AnnotationOptions<'line'>> | undefined;
        if (this.savingsRate && annotations?.['savingsRate']) {
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
                        scaleID: 'y',
                        type: 'line',
                        value: this.savingsRate
                      }
                    : undefined,
                  yAxis: getZeroLineAnnotation(this.colorScheme)
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
            scales: {
              x: getTimeAxisOptions({
                borderWidth: this.groupBy ? 0 : 1,
                colorScheme: this.colorScheme,
                locale: this.locale
              }),
              y: getValueAxisOptions({
                colorScheme: this.colorScheme,
                display: !this.isInPercentage,
                tickCallback: (tickValue) => {
                  return transformTickToAbbreviation(Number(tickValue));
                }
              })
            }
          },
          plugins: [getVerticalHoverLinePlugin(chartCanvas, this.colorScheme)],
          type: this.groupBy ? 'bar' : 'line'
        });
      }
    }
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
