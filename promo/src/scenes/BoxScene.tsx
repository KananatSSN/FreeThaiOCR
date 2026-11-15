import type React from 'react';
import { AbsoluteFill, Easing, Interactive, type InteractivitySchema, interpolate, useCurrentFrame } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Headline } from '../components/Headline';
import { ScreenCrop } from '../components/ScreenCrop';

type Props = { readonly title: string; readonly style?: React.CSSProperties };

const POP = Easing.bezier(0.2, 1.3, 0.35, 1);

/** Draw a box on the page; its text appears on its own card. */
const BoxInner: React.FC<Props> = ({ title, style }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={style}>
      <Backdrop />
      <Headline text={title} size={100} style={{ position: 'absolute', top: 170, left: 80, right: 80 }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', top: 400, bottom: 240, height: 'auto', gap: 48 }}>
        <ScreenCrop
          src="screens/desktop-box.png"
          region={{ x: 80, y: 270, w: 1560, h: 700 }}
          width={940}
          style={{
            scale: interpolate(frame, [0, 14], [0.7, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: POP }),
            opacity: interpolate(frame, [0, 6], [0, 1], { extrapolateRight: 'clamp' }),
          }}
        />
        <ScreenCrop
          src="screens/desktop-box.png"
          region={{ x: 1713, y: 314, w: 828, h: 341 }}
          width={940}
          style={{
            translate: interpolate(frame, [20, 34], ['0px 500px', '0px 0px'], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: POP }),
            opacity: interpolate(frame, [20, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const schema = { title: { type: 'text-content', default: 'ลาก|*กรอบ*|อ่านเฉพาะส่วน', description: 'Title' } } as const satisfies InteractivitySchema;
export const BoxScene = Interactive.withSchema({ Component: BoxInner, componentName: '<BoxScene>', schema, wrapInSequence: true });
