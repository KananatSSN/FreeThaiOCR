import type React from 'react';
import { AbsoluteFill } from 'remotion';
import { Backdrop } from './components/Backdrop';
import { Headline } from './components/Headline';
import { PhoneFrame } from './components/PhoneFrame';
import { Pill } from './components/Pill';
import { colors, fontFamily } from './theme';
import { Logo } from './scenes/CtaScene';

export type FacebookPostProps = {
  readonly headline1: string;
  readonly headline2: string;
  readonly subtitle: string;
  readonly features: string[];
  /** Credit for the OCR model this app is a UI for. `**text**` = highlighted. */
  readonly credit: string;
  readonly url: string;
};

const Check: React.FC = () => (
  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={colors.green} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 4 }}>
    <circle cx="12" cy="12" r="10" stroke={colors.green} strokeOpacity="0.35" />
    <path d="m8 12 3 3 5-6" />
  </svg>
);

/** 1080x1350 (4:5) feed image for a Facebook post: promise, features, real app, link. */
export const FacebookPost: React.FC<FacebookPostProps> = ({ headline1, headline2, subtitle, features, credit, url }) => {
  return (
    <AbsoluteFill style={{ fontFamily, color: colors.text }}>
      <Backdrop />
      {/* Brand */}
      <div style={{ position: 'absolute', top: 72, left: 80, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ borderRadius: 18, boxShadow: `0 0 40px ${colors.orange}44` }}>
          <Logo size={72} />
        </div>
        <span style={{ fontSize: 50, fontWeight: 800 }}>
          FreeThai<span style={{ color: colors.orange }}>OCR</span>
        </span>
      </div>
      {/* Promise */}
      <div style={{ position: 'absolute', top: 200, left: 80, right: 80 }}>
        <Headline text={headline1} size={118} align="left" still />
        <Headline text={headline2} size={118} align="left" still />
        <div style={{ marginTop: 22, fontSize: 44, fontWeight: 400, color: colors.muted, lineHeight: 1.35 }}>{subtitle}</div>
      </div>
      {/* Features (left) and the real app (right) */}
      <div style={{ position: 'absolute', top: 615, left: 80, width: 520, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {features.map((f) => (
          <div key={f} style={{ display: 'flex', gap: 18, fontSize: 42, fontWeight: 600, lineHeight: 1.3 }}>
            <Check />
            <span>{f}</span>
          </div>
        ))}
      </div>
      <PhoneFrame src="screens/phone-landing.png" width={420} style={{ left: 'auto', marginLeft: 0, right: 60, top: 630, rotate: '4deg' }} />
      {/* Link on a bottom band that the phone slides under */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 300,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 26,
          paddingBottom: 60,
          background: `linear-gradient(to bottom, transparent, ${colors.bg} 28%)`,
        }}
      >
        {/* Credit: this is a UI for iApp's model, not the model itself. */}
        <div style={{ fontSize: 34, color: colors.muted, textAlign: 'center', padding: '0 80px', lineHeight: 1.35 }}>
          {credit.split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? <strong key={i} style={{ color: colors.text, fontWeight: 600 }}>{part}</strong> : part))}
        </div>
        <Pill tone="orange" size={40}>
          {url}
        </Pill>
      </div>
    </AbsoluteFill>
  );
};
