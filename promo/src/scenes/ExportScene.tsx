import type React from 'react';
import { AbsoluteFill, Easing, Interactive, type InteractivitySchema, interpolate, useCurrentFrame } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Headline } from '../components/Headline';
import { Pill } from '../components/Pill';
import { ScreenCrop } from '../components/ScreenCrop';

type Props = { readonly title: string; readonly style?: React.CSSProperties };

const POP = Easing.bezier(0.2, 1.5, 0.35, 1);

const Badge: React.FC<{ readonly label: string; readonly at: number; readonly tone: 'orange' | 'blue' | 'green' | 'plain' }> = ({ label, at, tone }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ scale: interpolate(frame, [at, at + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: POP }) }}>
      <Pill tone={tone} size={58}>
        {label}
      </Pill>
    </div>
  );
};

/** The export menu, with the formats popping out around it. */
const ExportInner: React.FC<Props> = ({ title, style }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={style}>
      <Backdrop />
      <Headline text={title} size={110} style={{ position: 'absolute', top: 170, left: 80, right: 80 }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', top: 380, bottom: 160, height: 'auto', gap: 56 }}>
        <ScreenCrop
          src="screens/desktop-export.png"
          region={{ x: 2035, y: 179, w: 512, h: 589 }}
          width={720}
          style={{ scale: interpolate(frame, [0, 12], [0.6, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 1.2, 0.3, 1) }) }}
        />
        <div style={{ display: 'flex', gap: 24 }}>
          <Badge label="TXT" at={12} tone="plain" />
          <Badge label="JSON" at={16} tone="blue" />
          <Badge label="PDF" at={20} tone="orange" />
          <Badge label="ZIP" at={24} tone="green" />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const schema = { title: { type: 'text-content', default: 'ส่งออก|*ทุกแบบ*', description: 'Title' } } as const satisfies InteractivitySchema;
export const ExportScene = Interactive.withSchema({ Component: ExportInner, componentName: '<ExportScene>', schema, wrapInSequence: true });
