/** Measures CSS safe-area-insets for phones with notches and rounded corners.
 *  Uses real DOM probe elements; falls back to fixed padding on portrait mobile. */

let probes: { top: HTMLDivElement; bottom: HTMLDivElement; left: HTMLDivElement; right: HTMLDivElement } | null = null;

function ensureProbes() {
  if (probes) return probes;
  const make = (side: string) => {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;${side}:0;left:0;width:0;height:0;padding-${side}:env(safe-area-inset-${side},0px);pointer-events:none;visibility:hidden`;
    document.body.appendChild(el);
    return el;
  };
  probes = { top: make('top'), bottom: make('bottom'), left: make('left'), right: make('right') };
  return probes;
}

function isPortraitMobile(): boolean {
  return window.innerWidth < 500 && window.innerHeight > window.innerWidth;
}

export function getSafeTop(): number {
  const p = ensureProbes();
  const measured = p.top.offsetHeight;
  if (measured > 0) return measured;
  return isPortraitMobile() ? 12 : 0;
}

export function getSafeBottom(): number {
  const p = ensureProbes();
  const measured = p.bottom.offsetHeight;
  if (measured > 0) return measured;
  return isPortraitMobile() ? 16 : 0;
}

export function getSafeLeft(): number {
  const p = ensureProbes();
  const measured = p.left.offsetWidth;
  if (measured > 0) return measured;
  return 0;
}

export function getSafeRight(): number {
  const p = ensureProbes();
  const measured = p.right.offsetWidth;
  if (measured > 0) return measured;
  return 0;
}
