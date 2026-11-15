import type React from 'react';
import { AbsoluteFill, Easing, Interactive, type InteractivitySchema, interpolate, useCurrentFrame } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Headline } from '../components/Headline';
import { Pill } from '../components/Pill';
import { colors } from '../theme';

type Props = { readonly title: string; readonly subtitle: string; readonly style?: React.CSSProperties };

const POP = Easing.bezier(0.2, 1.5, 0.35, 1);

/** Private by design: nothing is uploaded. */
const PrivacyInner: React.FC<Props> = ({ title, subtitle, style }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={style}>
      <Backdrop hue="blue" />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 40, padding: '0 80px' }}>
        <div style={{ position: 'relative', width: 300, height: 300, scale: interpolate(frame, [0, 12], [0.3, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: POP }) }}>
          {/* Pulse ring */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: `6px solid ${colors.green}`,
              scale: interpolate(frame, [6, 40], [1, 1.6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
              opacity: interpolate(frame, [6, 40], [0.8, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            }}
          />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `${colors.green}22`, border: `6px solid ${colors.green}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="140" height="140" viewBox="0 0 24 24" fill="none" stroke={colors.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        </div>
        <Headline text={title} size={120} delay={6} />
        <Headline text={subtitle} size={48} weight={400} delay={14} color={colors.muted} />
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', marginTop: 20 }}>
          {[
            ['ฟรี', 28],
            ['โอเพนซอร์ส', 32],
            ['ใช้ออฟไลน์ได้', 36],
          ].map(([label, at]) => (
            <div key={label} style={{ scale: interpolate(frame, [at as number, (at as number) + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: POP }) }}>
              <Pill tone="green" size={48}>
                {label}
              </Pill>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const schema = {
  title: { type: 'text-content', default: 'ไฟล์|*ไม่ออก*|จากเครื่อง', description: 'Title' },
  subtitle: { type: 'text-content', default: 'OCR ทำงานในเบราว์เซอร์ ไม่มีการอัปโหลด', description: 'Subtitle' },
} as const satisfies InteractivitySchema;
export const PrivacyScene = Interactive.withSchema({ Component: PrivacyInner, componentName: '<PrivacyScene>', schema, wrapInSequence: true });
