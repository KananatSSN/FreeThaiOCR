import type React from 'react';
import { CanvasImage, staticFile, useVideoConfig } from 'remotion';

/** A phone body around a 1080x2254 app screenshot. `children` draw on top of the screen. */
export const PhoneFrame: React.FC<{
  readonly src: string;
  readonly width?: number;
  readonly style?: React.CSSProperties;
  readonly children?: React.ReactNode;
}> = ({ src, width = 760, style, children }) => {
  const { fps } = useVideoConfig();
  const screenH = Math.round((width * 2254) / 1080);
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        marginLeft: -(width + 32) / 2,
        width: width + 32,
        padding: 16,
        borderRadius: 72,
        background: 'linear-gradient(160deg, #3f3f46, #18181b 40%)',
        boxShadow: '0 60px 120px rgba(0,0,0,0.55), inset 0 0 0 2px rgba(255,255,255,0.08)',
        ...style,
      }}
    >
      <div style={{ position: 'relative', width, height: screenH, borderRadius: 58, overflow: 'hidden', background: '#fff' }}>
        <CanvasImage src={staticFile(src)} width={width} height={screenH} premountFor={fps} />
        {children}
      </div>
    </div>
  );
};
