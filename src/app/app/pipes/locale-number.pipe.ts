import { Pipe, PipeTransform } from '@angular/core';

export interface LocaleNumberOptions {
  minFractionDigits?: number;
  maxFractionDigits?: number;
}

@Pipe({ name: 'localeNumber', standalone: true })
export class LocaleNumberPipe implements PipeTransform {
  transform(
    value: number | null | undefined,
    options: LocaleNumberOptions = {}
  ): string {
    if (value == null || isNaN(value)) {
      return '';
    }
    const { minFractionDigits = 0, maxFractionDigits = 2 } = options;
    return new Intl.NumberFormat(navigator.language, {
      minimumFractionDigits: minFractionDigits,
      maximumFractionDigits: maxFractionDigits
    }).format(value);
  }
}
