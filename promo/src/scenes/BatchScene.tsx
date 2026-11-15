import type React from 'react';
import { AbsoluteFill, Easing, Interactive, type InteractivitySchema, interpolate, useCurrentFrame } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Headline } from '../components/Headline';
import { ScreenCrop } from '../components/ScreenCrop';

type Props = { readonly title: string; readonly style?: React.CSSProperties };

const POP = Easing.bezier(0.2, 1.4, 0.35, 1);

/** A whole folder, all read: the file sidebar plus the "all files read" chip. */
const BatchInner: React.FC<Props> = ({ title, style }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={style}>
      <Backdrop hue="blue" />
      <Headline text={title} size={100} style={{ position: 'absolute', top: 170, left: 80, right: 80 }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', top: 380, bottom: 240, height: 'auto', gap: 60 }}>
        <ScreenCrop
          src="screens/desktop-files.png"
          region={{ x: 0, y: 96, w: 521, h: 442 }}
          width={860}
          style={{
            translate: interpolate(frame, [0, 14], ['0px 700px', '0px 0px'], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 1.15, 0.3, 1) }),
          }}
        />
        <ScreenCrop
          src="screens/desktop-files.png"
          region={{ x: 1113, y: 113, w: 263, h: 43 }}
          width={760}
          radius={60}
          style={{
            scale: interpolate(frame, [24, 36], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: POP }),
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const schema = { title: { type: 'text-content', default: 'ทั้ง|*โฟลเดอร์*|ในคลิกเดียว', description: 'Title' } } as const satisfies InteractivitySchema;
export const BatchScene = Interactive.withSchema({ Component: BatchInner, componentName: '<BatchScene>', schema, wrapInSequence: true });
