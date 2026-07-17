/**
 * TopTenRing — a small SVG progress ring for "inTop10 / total" tracked keywords.
 * Real counts only; total<=0 renders nothing.
 */
import React from "react";
import Svg, { Circle, Text as SvgText } from "react-native-svg";
import { palette } from "../theme/index.js";

export function TopTenRing({ inTop10, total, size = 64 }: { inTop10: number; total: number; size?: number }) {
  if (total <= 0) return null;
  const r = 15.9155; // circumference ~= 100 for easy dasharray math
  const frac = Math.max(0, Math.min(1, inTop10 / total));
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36" testID="preview-topten-ring">
      <Circle cx={18} cy={18} r={r} fill="none" stroke={palette.line} strokeWidth={4} />
      <Circle
        cx={18} cy={18} r={r} fill="none" stroke={palette.signal} strokeWidth={4}
        strokeLinecap="round" strokeDasharray={`${frac * 100} 100`}
        transform="rotate(-90 18 18)"
      />
      <SvgText x={18} y={21} textAnchor="middle" fill={palette.ink} fontSize={9} fontWeight="700">
        {inTop10}/{total}
      </SvgText>
    </Svg>
  );
}
