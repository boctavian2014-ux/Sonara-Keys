import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

type Props = {
  size?: number;
};

/**
 * Inline mark: stylized keys + orbit — brand glyph, not a literal Shazam mark.
 */
export function AppMark({ size = 40 }: Props) {
  const s = size;
  return (
    <Svg width={s} height={s} viewBox="0 0 40 40">
      <Defs>
        <SvgGradient id="markGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#60A5FA" />
          <Stop offset="0.55" stopColor="#2DD4BF" />
          <Stop offset="1" stopColor="#6366F1" />
        </SvgGradient>
      </Defs>
      <Circle cx="20" cy="20" r="18" fill="rgba(255,255,255,0.06)" stroke="url(#markGrad)" strokeWidth={1.2} />
      <Path
        d="M12 26 L12 14 L15 14 L15 26 Z M17.5 26 L17.5 11 L20.5 11 L20.5 26 Z M23 26 L23 16 L26 16 L26 26 Z M28.5 26 L28.5 13 L31.5 13 L31.5 26 Z"
        fill="url(#markGrad)"
        opacity={0.95}
      />
      <Circle cx="20" cy="20" r="6" fill="none" stroke="url(#markGrad)" strokeWidth={0.8} opacity={0.35} />
    </Svg>
  );
}
