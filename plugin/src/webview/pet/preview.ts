import { isPetShape, resolvePetBodyInk, resolvePetEyeInk } from '../../../../desktop/pet/identity';

const MARK_PATHS = [
  'M13.237 21.041 24.319 12.851c.543-.402 1.32-.245 1.578.379 1.363 3.289.754 7.242-1.957 9.956-2.71 2.714-6.482 3.309-9.93 1.953l-3.766 1.746c5.401 3.696 11.96 2.782 16.059-1.324 3.251-3.255 4.258-7.692 3.317-11.693L29.111 5.091 13.234 21.044Z',
  'M10.95 23.031C7.073 19.324 7.742 13.585 11.05 10.276c2.446-2.449 6.454-3.449 9.952-1.979l3.758-1.737C24.083 6.07 23.215 5.543 22.22 5.173c-4.5-1.854-9.887-.931-13.545 2.728C5.156 11.424 4.05 16.84 5.95 21.462c1.419 3.454-.907 5.898-3.251 8.364C1.868 30.7 1.035 31.575.364 32.5L10.947 23.034Z',
];

export function petMarkPreview(opts: { shape: string; color: string; size: number }): HTMLElement {
  if (opts.shape === 'anime' || opts.shape === 'pixel' || opts.shape === 'adult') {
    const img = document.createElement('img');
    img.src = `./pet-assets/${opts.shape}-idle.png`;
    img.alt = opts.shape;
    const show = opts.shape === 'adult' ? Math.round(opts.size * 1.35) : opts.size;
    img.style.width = `${show}px`;
    img.style.height = `${show}px`;
    img.style.objectFit = 'contain';
    if (opts.shape === 'pixel') {
      img.style.imageRendering = 'pixelated';
    }
    return img;
  }
  const fill = resolvePetBodyInk(opts.color);
  const tone = resolvePetEyeInk(opts.color);
  const shape = isPetShape(opts.shape) ? opts.shape : 'star';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('width', String(opts.size));
  svg.setAttribute('height', String(opts.size));
  svg.style.display = 'block';
  const body =
    shape === 'mark'
      ? `<g transform="translate(12 14) scale(2.7)">${MARK_PATHS.map((d) => `<path d="${d}" fill="${fill}"/>`).join('')}</g>`
      : shape === 'orb'
        ? `<ellipse cx="60" cy="64" rx="42" ry="40" fill="${fill}"/>`
        : `<path d="M60 6C63 32 78 47 104 60 78 73 63 88 60 114 57 88 42 73 16 60 42 47 57 32 60 6Z" fill="${fill}"/>`;
  svg.innerHTML = `${body}
    <ellipse cx="46" cy="56" rx="9" ry="11" fill="${tone.eye}"/>
    <ellipse cx="74" cy="56" rx="9" ry="11" fill="${tone.eye}"/>
    <circle cx="47" cy="58" r="4.4" fill="${tone.pupil}"/>
    <circle cx="75" cy="58" r="4.4" fill="${tone.pupil}"/>`;
  return svg;
}
