import { Component, computed, input } from '@angular/core';

interface ProviderMatcher {
  fileName: string;
  patterns: string[];
}

const PROVIDER_MATCHERS: ProviderMatcher[] = [
  { fileName: 'vanguard', patterns: ['vanguard'] },
  { fileName: 'ishares', patterns: ['ishares'] },
  { fileName: 'state-street', patterns: ['state street', 'spdr'] }
];

const PLACEHOLDER_FILE_NAME = 'placeholder';
const LOGO_BASE_PATH = '/etf-logos';

@Component({
  selector: 'app-etf-provider-logo',
  templateUrl: './etf-provider-logo.html',
  styleUrl: './etf-provider-logo.scss'
})
export class EtfProviderLogo {
  readonly name = input<string | null | undefined>(null);

  protected readonly logoUrl = computed(() => {
    const normalizedName = (this.name() ?? '').toLowerCase();
    const matcher = PROVIDER_MATCHERS.find((candidate) =>
      candidate.patterns.some((pattern) => normalizedName.includes(pattern))
    );

    return `${LOGO_BASE_PATH}/${matcher?.fileName ?? PLACEHOLDER_FILE_NAME}.svg`;
  });
}
