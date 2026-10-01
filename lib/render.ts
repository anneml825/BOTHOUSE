import { Resvg } from '@resvg/resvg-js';
import { pictureToSvg, Shape } from './canvas';

// Server-only: the current picture as a base64 PNG, so the bots can see it.
// Returns null if rendering fails, so a turn never breaks because of the picture.
export function renderPicturePng(shapes: Shape[]): string | null {
  try {
    const png = new Resvg(pictureToSvg(shapes), {
      background: '#ffffff',
      fitTo: { mode: 'width', value: 800 },
      font: { loadSystemFonts: true, defaultFontFamily: 'sans-serif' },
    })
      .render()
      .asPng();
    return Buffer.from(png).toString('base64');
  } catch (err) {
    console.error('[render]', err);
    return null;
  }
}
