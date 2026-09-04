import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  viewChild
} from '@angular/core';
import {
  ArcElement,
  Chart,
  type ChartData,
  type ChartType,
  DoughnutController,
  type Plugin,
  Tooltip
} from 'chart.js';
import ChartDataLabels, { type Context as DataLabelsContext } from 'chartjs-plugin-datalabels';

import {
  formatDonutPercentage,
  formatDonutValue,
  generateDonutPalette,
  getDonutBorderColor,
  readCssVariable,
  wrapCenterLabel
} from './allocation-donut-chart.helpers';
import type { AllocationChartItem, ColorScheme } from './allocation-donut-chart.types';

interface CenterTextState {
  label: string;
  labelColor: string;
  percentageLine?: string;
  value: string;
  valueColor: string;
}

declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType> {
    centerText?: CenterTextState;
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-allocation-donut-chart',
  standalone: true,
  styleUrl: './allocation-donut-chart.component.scss',
  templateUrl: './allocation-donut-chart.component.html'
})
export class AllocationDonutChartComponent implements OnChanges, OnDestroy {
  @Input() colorScheme: ColorScheme = 'LIGHT';
  @Input() currency = 'USD';
  @Input() items: AllocationChartItem[] = [];
  @Input() locale = globalThis.navigator?.language ?? 'en-US';
  @Input() totalLabel = 'Total';
  @Input() totalValue = 0;

  private readonly chartCanvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('chartCanvas');

  private chart: Chart<'doughnut', number[]> | undefined;
  private labelColor = '#64748b';
  private valueColor = '#0f172a';

  public constructor() {
    Chart.register(ArcElement, DoughnutController, Tooltip);
  }

  public ngOnChanges() {
    this.render();
  }

  public ngOnDestroy() {
    this.chart?.destroy();
  }

  private render() {
    const canvas = this.chartCanvas()?.nativeElement;

    if (!canvas || !this.items.length) {
      this.chart?.destroy();
      this.chart = undefined;

      return;
    }

    const colors = generateDonutPalette(this.items.length, this.colorScheme);
    const borderColor = getDonutBorderColor(this.colorScheme);
    this.labelColor = readCssVariable(canvas, '--app-muted-text', '#64748b');
    this.valueColor = readCssVariable(canvas, '--app-text', '#0f172a');

    const data: ChartData<'doughnut'> = {
      labels: this.items.map((item) => item.symbol),
      datasets: [
        {
          backgroundColor: colors,
          borderColor,
          borderWidth: 2,
          data: this.items.map((item) => item.value)
        }
      ]
    };

    const totalCenterText: CenterTextState = {
      label: this.totalLabel,
      labelColor: this.labelColor,
      value: formatDonutValue(this.totalValue, this.currency, this.locale),
      valueColor: this.valueColor
    };

    if (this.chart) {
      this.chart.data = data;
      this.chart.options.plugins ??= {};
      this.chart.options.plugins.centerText = totalCenterText;
      this.chart.update();

      return;
    }

    const getHoverCenterText = (activeIndex: number | undefined): CenterTextState => {
      const item = activeIndex != null ? this.items[activeIndex] : undefined;

      if (!item) {
        return {
          label: this.totalLabel,
          labelColor: this.labelColor,
          value: formatDonutValue(this.totalValue, this.currency, this.locale),
          valueColor: this.valueColor
        };
      }

      return {
        label: item.name || item.symbol,
        labelColor: this.labelColor,
        percentageLine: formatDonutPercentage(item.percentage, this.locale),
        value: formatDonutValue(item.value, item.currency || this.currency, this.locale),
        valueColor: this.valueColor
      };
    };

    this.chart = new Chart<'doughnut', number[]>(canvas, {
      data,
      options: {
        animation: { duration: 600, easing: 'easeOutQuart' },
        cutout: '62%',
        maintainAspectRatio: true,
        onHover: (_event, activeElements) => {
          if (!this.chart) {
            return;
          }

          this.chart.options.plugins ??= {};
          this.chart.options.plugins.centerText = getHoverCenterText(activeElements[0]?.index);
          this.chart.update('none');
        },
        plugins: {
          centerText: totalCenterText,
          datalabels: {
            backgroundColor: (context: DataLabelsContext) =>
              (context.dataset.backgroundColor as string[] | undefined)?.[context.dataIndex] ??
              '#64748b',
            borderRadius: 999,
            color: '#ffffff',
            font: { size: 11, weight: 'bold' },
            formatter: (_value: number, context: DataLabelsContext) => {
              const item = this.items[context.dataIndex];

              return item ? formatDonutPercentage(item.percentage, this.locale) : '';
            },
            padding: { bottom: 4, left: 6, right: 6, top: 4 }
          },
          legend: { display: false }
        },
        responsive: true
      },
      plugins: [ChartDataLabels, centerTextPlugin],
      type: 'doughnut'
    });
  }
}

const centerTextPlugin: Plugin<'doughnut'> = {
  afterDraw(chart) {
    const centerText = chart.options.plugins?.centerText;

    if (!centerText) {
      return;
    }

    const label = centerText.label ?? '';
    const labelColor = centerText.labelColor ?? '#64748b';
    const value = centerText.value ?? '';
    const valueColor = centerText.valueColor ?? '#0f172a';
    const percentageLine = centerText.percentageLine;
    const { chartArea, ctx } = chart;
    const centerX = (chartArea.left + chartArea.right) / 2;
    const centerY = (chartArea.top + chartArea.bottom) / 2;
    const labelFont = '400 13px sans-serif';
    const valueFont = '700 20px sans-serif';
    const percentageFont = '400 13px sans-serif';
    const outerRadius = Math.min(chartArea.width, chartArea.height) / 2;
    const innerRadius = outerRadius * 0.62;
    const maxLabelWidth = innerRadius * 1.7;

    const labelLines = wrapCenterLabel(ctx, label, maxLabelWidth, 2, labelFont);
    const labelLineHeight = 15;
    const valueLineHeight = 24;
    const percentageLineHeight = 15;
    const lines = [
      ...labelLines.map((line) => ({
        color: labelColor,
        font: labelFont,
        height: labelLineHeight,
        text: line
      })),
      { color: valueColor, font: valueFont, height: valueLineHeight, text: value },
      ...(percentageLine
        ? [
            {
              color: labelColor,
              font: percentageFont,
              height: percentageLineHeight,
              text: percentageLine
            }
          ]
        : [])
    ];
    const totalHeight = lines.reduce((sum, line) => sum + line.height, 0);
    let y = centerY - totalHeight / 2;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const line of lines) {
      y += line.height / 2;
      ctx.font = line.font;
      ctx.fillStyle = line.color;
      ctx.fillText(line.text, centerX, y);
      y += line.height / 2;
    }

    ctx.restore();
  },
  id: 'centerText'
};
