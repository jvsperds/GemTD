import devIcon from './assets/icon-dev.svg?raw';

/** The server overrides Vite's default so deployment branding is selected at runtime. */
export function initBranding() {
  const deployment = document.querySelector<HTMLMetaElement>('meta[name="gemtd-is-dev"]');
  const isDev = deployment ? deployment.content === 'true' : import.meta.env.DEV;
  document.title = isDev ? 'GemTD (dev)' : 'GemTD';
  if (isDev) {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = `data:image/svg+xml,${encodeURIComponent(devIcon)}`;
  }
  return __BUILD__ + (isDev ? ' (dev)' : '');
}
