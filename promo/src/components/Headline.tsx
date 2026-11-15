import type React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { colors, fontFamily } from '../theme';

type Props = {
  /** `*word*` = accent colour; `|` = an animation break without a visible space (Thai). */
  readonly text: string;
  readonly size?: number;
  readonly delay?: number;
  readonly weight?: number;
  readonly color?: string;
  readonly align?: 'center' | 'left';
  /** No animation: every word fully visible (for stills). */
  readonly still?: boolean;
  readonly style?: React.CSSProperties;
};

/** Words pop up one after another with a spring: the fast "kinetic type" look. */
export const Headline: React.FC<Props> = ({ text, size = 104, delay = 0, weight = 800, color = colors.text, align = 'center', still = false, style }) => {
  const frame = useCurrentFrame();
  const chunks = text.split(/(\s+|\|)/).filter((c) => c && c !== '|');
  // Stagger order counts words only (not spaces), computed up front.
  const order = chunks.map((c, k) => chunks.slice(0, k).filter((x) => !/^\s+$/.test(x)).length);
  return (
    <div
      style={{
        fontFamily,
        fontSize: size,
        fontWeight: weight,
        lineHeight: 1.18,
        color,
        textAlign: align,
        letterSpacing: '-0.01em',
        textWrap: 'balance',
        ...style,
      }}
    >
      {chunks.map((chunk, k) => {
        if (/^\s+$/.test(chunk)) return <span key={k}> </span>;
        const accent = /^\*.*\*$/.test(chunk);
        const t = delay + order[k] * 3;
        return (
          <span
            key={k}
            style={{
              display: 'inline-block',
              color: accent ? colors.orange : undefined,
              opacity: still ? 1 : interpolate(frame, [t, t + 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
              translate: still ? undefined : interpolate(frame, [t, t + 12], ['0px 60px', '0px 0px'], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: Easing.bezier(0.2, 1.4, 0.4, 1),
              }),
            }}
          >
            {accent ? chunk.slice(1, -1) : chunk}
          </span>
        );
      })}
    </div>
  );
};
