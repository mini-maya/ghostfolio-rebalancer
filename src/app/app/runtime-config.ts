interface RuntimeConfig {
  accessToken: string;
  allocationsText: string;
  baseUrl: string;
  hasInjectedDefaults: boolean;
}

declare global {
  interface Window {
    __GHOSTFOLIO_REBALANCER_CONFIG?: {
      accessTokenBase64?: string;
      allocationsTextBase64?: string;
      baseUrlBase64?: string;
    };
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  const config = window.__GHOSTFOLIO_REBALANCER_CONFIG;
  const accessToken = decodeBase64(config?.accessTokenBase64);
  const allocationsText = decodeBase64(config?.allocationsTextBase64);
  const baseUrl = decodeBase64(config?.baseUrlBase64);

  return {
    accessToken,
    allocationsText,
    baseUrl,
    hasInjectedDefaults: Boolean(accessToken || allocationsText || baseUrl)
  };
}

function decodeBase64(value?: string): string {
  if (!value) {
    return '';
  }

  try {
    return atob(value);
  } catch {
    return '';
  }
}
