import type React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { colors } from '../theme';

/** Dark background with two slowly drifting glows and a faint grid. */
export const Backdrop: React.FC<{ readonly hue?: 'orange' | 'blue' }> = ({ hue = 'orange' }) => {
  const frame = useCurrentFrame();
  const a = hue === 'orange' ? colors.orangeDeep : colors.blue;
  const b = hue === 'orange' ? colors.blue : colors.orangeDeep;
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          translate: interpolate(frame, [0, 90], ['0px 0px', '0px 72px'], { extrapolateRight: 'extend' }),
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 900,
          height: 900,
          borderRadius: '50%',
          background: a,
          opacity: 0.32,
          filter: 'blur(160px)',
          translate: interpolate(frame, [0, 120], ['-260px -220px', '-160px -120px'], { extrapolateRight: 'extend' }),
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: -300,
          bottom: -200,
          width: 800,
          height: 800,
          borderRadius: '50%',
          background: b,
          opacity: 0.22,
          filter: 'blur(160px)',
          translate: interpolate(frame, [0, 120], ['0px 0px', '-80px -100px'], { extrapolateRight: 'extend' }),
        }}
      />
    </AbsoluteFill>
  );
};
