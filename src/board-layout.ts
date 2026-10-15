import type { Renderer } from './render';

/** Keep the touch playing field clear of the actual, responsive HUD rectangles. */
export function initBoardLayout(canvas: HTMLCanvasElement, view: Renderer) {
  const panel = document.querySelector<HTMLElement>('#panel')!;
  const tools = document.querySelector<HTMLElement>('#boardtools')!;
  const header = document.querySelector<HTMLElement>('#hud')!;
  const hint = document.querySelector<HTMLElement>('#hint')!;
  const dock = document.querySelector<HTMLElement>('#dock')!;
  const status = document.querySelector<HTMLElement>('#status')!;
  const mobile = matchMedia('(max-width: 760px), (pointer: coarse)');
  let frame = 0;
  let previous = '';
  const measure = () => {
    frame = 0;
    const oldBounds = canvas.getBoundingClientRect();
    const preserve = previous !== '' && canvas.dataset.contained === '1' && mobile.matches;
    document.body.style.setProperty('--panel-height', `${panel.getBoundingClientRect().height}px`);
    document.body.style.setProperty(
      '--boardtools-height',
      `${tools.getBoundingClientRect().height}px`,
    );
    let key = 'full';
    if (mobile.matches) {
      const landscape = innerHeight <= 500 && innerWidth > innerHeight;
      const p = panel.getBoundingClientRect();
      const h = header.getBoundingClientRect();
      const tip = hint.getBoundingClientRect();
      const d = dock.getBoundingClientRect();
      const t = tools.getBoundingClientRect();
      const s = status.getBoundingClientRect();
      const styles = getComputedStyle(document.body);
      const safe = (side: string) =>
        Math.max(8, parseFloat(styles.getPropertyValue(`--safe-${side}`)) || 0);
      const left = safe('left');
      const top = Math.ceil(
        Math.max(h.bottom, tip.bottom, landscape && !dock.hidden ? d.bottom : 0) + 8,
      );
      const right = Math.floor(landscape ? p.left - 8 : innerWidth - safe('right'));
      const bottom = Math.floor(
        landscape
          ? innerHeight - safe('bottom')
          : Math.min(
              p.top,
              t.height ? t.top : p.top,
              !dock.hidden ? d.top : p.top,
              s.height ? s.top : p.top,
            ) - 8,
      );
      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);
      key = `${left},${top},${width},${height}`;
      if (key === previous) return;
      Object.assign(canvas.style, {
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
      canvas.dataset.contained = '1';
    } else {
      if (key === previous) return;
      canvas.removeAttribute('style');
      delete canvas.dataset.contained;
    }
    previous = key;
    const newBounds = canvas.getBoundingClientRect();
    view.resize(preserve, oldBounds.left - newBounds.left, oldBounds.top - newBounds.top);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  const observer = new ResizeObserver(schedule);
  for (const element of [panel, tools, header, hint, dock, status]) observer.observe(element);
  addEventListener('resize', schedule);
  mobile.addEventListener('change', schedule);
  measure();
}
