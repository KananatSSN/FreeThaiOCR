import type React from 'react';
import { AbsoluteFill, CanvasImage, Easing, Interactive, type InteractivitySchema, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Headline } from '../components/Headline';
import { PhoneFrame } from '../components/PhoneFrame';
import { colors } from '../theme';

type Props = { readonly title: string; readonly style?: React.CSSProperties };

const PHONE_W = 760
const SCREEN_H = Math.round((PHONE_W * 2254) / 1080)

/** The scan: a beam passes down the page and the detected lines light up behind it. */
const DetectInner: React.FC<Props> = ({ title, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Sweep over the document area of the screenshot (about 28%–74% of the screen height).
  const p = interpolate(frame, [12, 58], [0.28, 0.74], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad) });
  return (
    <AbsoluteFill style={style}>
      <Backdrop hue="blue" />
      <Headline text={title} size={100} style={{ position: 'absolute', top: 170, left: 80, right: 80 }} />
      <PhoneFrame
        src="screens/phone-doc.png"
        width={PHONE_W}
        style={{
          top: 470,
          // Push in on the page so the lines lighting up are easy to see. Anchored at
          // the top so the phone grows downward and never covers the headline.
          transformOrigin: '50% 0%',
          scale: interpolate(frame, [4, 60], [1, 1.18], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad) }),
        }}
      >
        <CanvasImage
          src={staticFile('screens/phone-lines.png')}
          width={PHONE_W}
          height={SCREEN_H}
          premountFor={fps}
          style={{ position: 'absolute', inset: 0, clipPath: `inset(0 0 ${(1 - p) * 100}% 0)` }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: p * SCREEN_H,
            height: 6,
            background: colors.blue,
            boxShadow: `0 0 36px 10px ${colors.blue}99`,
            opacity: interpolate(frame, [10, 14, 56, 62], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}
        />
      </PhoneFrame>
    </AbsoluteFill>
  );
};

const schema = { title: { type: 'text-content', default: 'เจอทุก|*บรรทัด*|อัตโนมัติ', description: 'Title' } } as const satisfies InteractivitySchema;
export const DetectScene = Interactive.withSchema({ Component: DetectInner, componentName: '<DetectScene>', schema, wrapInSequence: true });
