import type React from 'react';
import { AbsoluteFill, Easing, Interactive, type InteractivitySchema, interpolate, useCurrentFrame } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Headline } from '../components/Headline';
import { PhoneFrame } from '../components/PhoneFrame';
import { Pill } from '../components/Pill';

type Props = { readonly title: string; readonly style?: React.CSSProperties };

const RISE = Easing.bezier(0.2, 1.15, 0.3, 1);

/** Files fly from both sides into the phone. */
const Chip: React.FC<{ readonly label: string; readonly from: [number, number]; readonly at: number; readonly tone: 'orange' | 'blue' | 'green' | 'plain' }> = ({ label, from, at, tone }) => {
  const frame = useCurrentFrame();
  return (
    // The outer box centres the chip on the phone; the inner one flies in from `from`.
    <div style={{ position: 'absolute', left: 540, top: 1180, translate: '-50% -50%' }}>
      <div
        style={{
          translate: interpolate(frame, [at, at + 16], [`${from[0]}px ${from[1]}px`, '0px 0px'], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) }),
          scale: interpolate(frame, [at, at + 16], [1.2, 0.3], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          opacity: interpolate(frame, [at, at + 3, at + 13, at + 16], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        }}
      >
        <Pill tone={tone} size={56}>
          {label}
        </Pill>
      </div>
    </div>
  );
};

const UploadInner: React.FC<Props> = ({ title, style }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={style}>
      <Backdrop hue="blue" />
      <Headline text={title} size={100} style={{ position: 'absolute', top: 170, left: 80, right: 80 }} />
      <PhoneFrame
        src="screens/phone-landing.png"
        style={{
          top: 560,
          translate: interpolate(frame, [0, 16], ['0px 1100px', '0px 0px'], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: RISE }),
        }}
      />
      <Chip label="PDF" from={[-700, -300]} at={16} tone="orange" />
      <Chip label="JPG" from={[520, -420]} at={22} tone="blue" />
      <Chip label="PNG" from={[-640, 260]} at={28} tone="green" />
      <Chip label="📁 โฟลเดอร์" from={[560, 200]} at={34} tone="plain" />
    </AbsoluteFill>
  );
};

const schema = { title: { type: 'text-content', default: 'ลากไฟล์ หรือ|*ทั้งโฟลเดอร์*', description: 'Title' } } as const satisfies InteractivitySchema;
export const UploadScene = Interactive.withSchema({ Component: UploadInner, componentName: '<UploadScene>', schema, wrapInSequence: true });
