import type React from 'react';
import { CanvasImage, staticFile, useVideoConfig } from 'remotion';

/**
 * Shows the region {x, y, w, h} (image pixels) of a 2560x1600 desktop screenshot,
 * scaled to `width` px, as a rounded card.
 */
export const ScreenCrop: React.FC<{
  readonly src: string;
  readonly region: { x: number; y: number; w: number; h: number };
  readonly width: number;
  readonly radius?: number;
  readonly style?: React.CSSProperties;
}> = ({ src, region, width, radius = 28, style }) => {
  const { fps } = useVideoConfig();
  const k = width / region.w;
  return (
    <div
      style={{
        position: 'relative',
        width,
        height: Math.round(region.h * k),
        overflow: 'hidden',
        borderRadius: radius,
        background: '#fff',
        boxShadow: '0 40px 100px rgba(0,0,0,0.5), 0 0 0 2px rgba(255,255,255,0.06)',
        ...style,
      }}
    >
      <CanvasImage
        src={staticFile(src)}
        width={Math.round(2560 * k)}
        height={Math.round(1600 * k)}
        premountFor={fps}
        style={{ position: 'absolute', left: -region.x * k, top: -region.y * k }}
      />
    </div>
  );
};
