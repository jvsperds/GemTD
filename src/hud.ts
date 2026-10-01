/** Line icons for the HUD buttons (24×24, stroked in currentColor so they follow the theme). */
const PATHS: Record<string, string> = {
  guide: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  path: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h6a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h6"/>',
  ranges:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  book: '<path d="M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0 0 4h14v-4"/><path d="M8 7h8M8 11h5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  speed: '<path d="M3 5l8 7-8 7zM13 5l8 7-8 7z"/>',
  keep: '<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M9 3l3 6 3-6M12 21 9 9M12 21l3-12"/>',
  merge2: '<path d="M12 20V5M5 12l7-7 7 7"/>',
  merge4: '<path d="M5 12l7-7 7 7M5 20l7-7 7 7"/>',
  down: '<path d="M12 4v15M5 12l7 7 7-7"/>',
  clear: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  back: '<path d="M6 6l12 12M18 6 6 18"/>',
  level: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4l-5.3 3 1.2-6-4.5-4.1 6-.7z"/>',
  stone: '<path d="M3 21l9-9M12 4l8 8-3 3-8-8z"/><path d="M14 6l4 4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M2 20h20"/>',
};

export const icon = (name: string) =>
  name in PATHS
    ? `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
    : '';

/** Fill every `<i data-icon="name">` in the page. */
export function fillIcons(root: ParentNode = document) {
  for (const i of root.querySelectorAll<HTMLElement>('[data-icon]'))
    i.innerHTML = icon(i.dataset.icon!);
}
