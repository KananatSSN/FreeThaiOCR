import type React from 'react';
import { colors, fontFamily } from '../theme';

export const Pill: React.FC<{ readonly children: React.ReactNode; readonly tone?: 'orange' | 'blue' | 'green' | 'plain'; readonly size?: number; readonly style?: React.CSSProperties }> = ({ children, tone = 'plain', size = 44, style }) => {
  const c = { orange: colors.orange, blue: colors.blue, green: colors.green, plain: colors.text }[tone];
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 14,
        padding: `${size * 0.32}px ${size * 0.62}px`,
        borderRadius: 999,
        fontFamily,
        fontSize: size,
        fontWeight: 600,
        color: c,
        background: 'rgba(255,255,255,0.06)',
        border: `2px solid ${tone === 'plain' ? 'rgba(255,255,255,0.14)' : c}`,
        backdropFilter: 'blur(8px)',
        ...style,
      }}
    >
      {children}
    </div>
  );
};
