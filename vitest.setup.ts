import { vi } from 'vitest';

Object.defineProperty(window.navigator, 'language', {
  configurable: true,
  value: 'de-DE'
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn((media: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: false,
    media,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn()
  }))
});
