import type React from 'react';
import { AbsoluteFill, Easing, Interactive, type InteractivitySchema, interpolate, useCurrentFrame } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Headline } from '../components/Headline';
import { Pill } from '../components/Pill';
import { colors } from '../theme';

type Props = { readonly tag: string; readonly line1: string; readonly line2: string; readonly style?: React.CSSProperties };

/** 0–2 s: the promise, with a scan beam sweeping over the words. */
const HookInner: React.FC<Props> = ({ tag, line1, line2, style }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={style}>
      <Backdrop />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 28, padding: '0 80px' }}>
        <div style={{ opacity: interpolate(frame, [0, 6], [0, 1], { extrapolateRight: 'clamp' }) }}>
          <Pill tone="orange">{tag}</Pill>
        </div>
        <Headline text={line1} size={150} delay={3} />
        <Headline text={line2} size={150} delay={10} />
      </AbsoluteFill>
      {/* The scanner: a glowing line passing over the headline. */}
      <div
        style={{
          position: 'absolute',
          left: 60,
          right: 60,
          height: 8,
          borderRadius: 8,
          background: colors.orange,
          boxShadow: `0 0 40px 12px ${colors.orange}88`,
          top: interpolate(frame, [12, 44], [640, 1300], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) }),
          opacity: interpolate(frame, [10, 14, 40, 48], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        }}
      />
    </AbsoluteFill>
  );
};

const schema = {
  tag: { type: 'text-content', default: 'OCR ภาษาไทย · ฟรี', description: 'Tag' },
  line1: { type: 'text-content', default: 'เปลี่ยน|*รูปภาพ*', description: 'Line 1' },
  line2: { type: 'text-content', default: 'เป็น|*ข้อความ*', description: 'Line 2' },
} as const satisfies InteractivitySchema;

export const HookScene = Interactive.withSchema({ Component: HookInner, componentName: '<HookScene>', schema, wrapInSequence: true });
