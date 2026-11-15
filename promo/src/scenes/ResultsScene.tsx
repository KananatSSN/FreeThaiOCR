import type React from 'react';
import { AbsoluteFill, Easing, Interactive, type InteractivitySchema, interpolate, useCurrentFrame } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Headline } from '../components/Headline';
import { PhoneFrame } from '../components/PhoneFrame';
import { colors } from '../theme';

type Props = { readonly title: string; readonly subtitle: string; readonly style?: React.CSSProperties };

const ResultsInner: React.FC<Props> = ({ title, subtitle, style }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={style}>
      <Backdrop />
      <Headline text={title} size={110} style={{ position: 'absolute', top: 150, left: 80, right: 80 }} />
      <Headline text={subtitle} size={50} weight={400} delay={10} color={colors.muted} style={{ position: 'absolute', top: 310, left: 80, right: 80 }} />
      <PhoneFrame
        src="screens/phone-results.png"
        style={{
          top: 470,
          translate: interpolate(frame, [0, 14], ['0px 900px', '0px 0px'], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 1.15, 0.3, 1) }),
        }}
      />
    </AbsoluteFill>
  );
};

const schema = {
  title: { type: 'text-content', default: 'ได้|*ข้อความ*|ทันที', description: 'Title' },
  subtitle: { type: 'text-content', default: 'คัดลอก · แก้ไข · ส่งออก', description: 'Subtitle' },
} as const satisfies InteractivitySchema;
export const ResultsScene = Interactive.withSchema({ Component: ResultsInner, componentName: '<ResultsScene>', schema, wrapInSequence: true });
