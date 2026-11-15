import type React from 'react';
import { AbsoluteFill, Easing, Interactive, type InteractivitySchema, interpolate, useCurrentFrame } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Headline } from '../components/Headline';
import { Pill } from '../components/Pill';
import { colors } from '../theme';

type Props = { readonly brand: string; readonly tagline: string; readonly url: string; readonly style?: React.CSSProperties };

/** The app icon (same artwork as the site's favicon). */
export const Logo: React.FC<{ readonly size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <rect width="32" height="32" rx="7" fill="#171717" />
    <path d="M9 6H7a1 1 0 0 0-1 1v2M23 6h2a1 1 0 0 1 1 1v2M9 26H7a1 1 0 0 1-1-1v-2M23 26h2a1 1 0 0 0 1-1v-2" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
    <path d="M10 12h12M10 16h9M10 20h11" stroke="#fb923c" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const CtaInner: React.FC<Props> = ({ brand, tagline, url, style }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={style}>
      <Backdrop />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 36, padding: '0 80px' }}>
        <div
          style={{
            borderRadius: 64,
            boxShadow: `0 0 120px ${colors.orange}55, 0 30px 80px rgba(0,0,0,0.6)`,
            scale: interpolate(frame, [0, 16], [0.2, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 1.5, 0.35, 1) }),
            rotate: interpolate(frame, [0, 16], ['-25deg', '0deg'], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }),
          }}
        >
          <Logo size={260} />
        </div>
        <Headline text={brand} size={132} delay={8} />
        <Headline text={tagline} size={54} weight={400} delay={16} color={colors.muted} />
        <div style={{ marginTop: 24, opacity: interpolate(frame, [28, 36], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), translate: interpolate(frame, [28, 38], ['0px 30px', '0px 0px'], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }) }}>
          <Pill tone="orange" size={50}>
            {url}
          </Pill>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const schema = {
  brand: { type: 'text-content', default: 'Free|Thai|*OCR*', description: 'Brand' },
  tagline: { type: 'text-content', default: 'OCR ภาษาไทย ฟรี ในเบราว์เซอร์', description: 'Tagline' },
  url: { type: 'text-content', default: 'github.com/KananatSSN/FreeThaiOCR', description: 'Link' },
} as const satisfies InteractivitySchema;
export const CtaScene = Interactive.withSchema({ Component: CtaInner, componentName: '<CtaScene>', schema, wrapInSequence: true });
