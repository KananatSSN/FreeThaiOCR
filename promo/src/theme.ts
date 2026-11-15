import { loadFont } from '@remotion/google-fonts/Kanit';

// Kanit: a bold, modern face with full Thai and Latin coverage.
export const { fontFamily } = loadFont('normal', {
  weights: ['400', '600', '800'],
  subsets: ['thai', 'latin'],
});

// FreeThaiOCR brand: near-black UI, orange accent (boxes), blue (detected lines).
export const colors = {
  bg: '#09090b',
  panel: '#18181b',
  text: '#fafafa',
  muted: '#a1a1aa',
  orange: '#fb923c',
  orangeDeep: '#ea580c',
  blue: '#3b82f6',
  green: '#34d399',
};

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
