/**
 * Brand pieces the public screens compose — the mobile mirror of the landing
 * page's identity (docs/landing/index.html): a mono kicker pill, a mono
 * eyebrow, a Fraunces headline with a signal-green highlight, and the
 * "terminal" block that shows the loop as five steps.
 *
 * Every string here is static product copy: no numbers (measured-or-nothing
 * has nothing to measure on a marketing block, so it states none) and no price
 * language (these screens are captured into App Store screenshots, and Apple
 * reads "free" as a price claim — Guideline 2.3.7). brand.test.tsx pins both.
 */
import React from "react";
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import { fontSize, radius, spacing, typeface, usePalette } from "../theme/index.js";
import { AppText } from "./primitives.js";

/** The tick mark from the landing page, sized for a text row. */
export function BrandMark({ size = 22 }: { size?: number }) {
  const palette = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }} testID="brand-mark">
      <View
        style={{
          width: size,
          height: size,
          borderRadius: 6,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.signalGlow,
          borderWidth: 1,
          borderColor: palette.signalDim,
        }}
      >
        <Svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24">
          <Path d="M12 4 L6.5 12.5 h11 Z" fill={palette.signal} />
          <Path d="M4 14.5 h16 l-2.2 4 H6.2 Z" fill={palette.signal} />
        </Svg>
      </View>
      <Text style={{ fontFamily: typeface.mono, fontSize: fontSize.body, color: palette.ink, letterSpacing: -0.3 }}>
        ShipASO
      </Text>
    </View>
  );
}

/** The pill above the headline: a live dot + mono caption. */
export function Kicker({ children, testID }: { children: string; testID?: string }) {
  const palette = usePalette();
  return (
    <View
      testID={testID}
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: palette.signalGlow,
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.signal }} />
      <Text style={{ fontFamily: typeface.mono, fontSize: fontSize.micro, color: palette.signal, letterSpacing: 0.3 }}>
        {children}
      </Text>
    </View>
  );
}

/** A mono, uppercase section label — the landing's `.eyebrow`. */
export function Eyebrow({ children, testID, style }: { children: string; testID?: string; style?: StyleProp<TextStyle> }) {
  const palette = usePalette();
  return (
    <Text
      testID={testID}
      style={[
        { fontFamily: typeface.mono, fontSize: fontSize.micro, letterSpacing: 1.2, textTransform: "uppercase", color: palette.signalDim },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** A span inside a Headline set in the signal colour. Inherits the parent face. */
export function Highlight({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  return <Text style={{ color: palette.signal }}>{children}</Text>;
}

/** The Fraunces headline. Compose with <Highlight> for the emphasised clause. */
export function Headline({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <AppText kind="display" style={[{ lineHeight: fontSize.display * 1.08 }, style]}>
      {children}
    </AppText>
  );
}

/** The five steps of the loop, as the landing shows them. Static, number-free. */
export const LOOP_STEPS = [
  { arrow: "$", verb: "audit", note: "live listing, field by field" },
  { arrow: "→", verb: "research", note: "keywords on real rank data" },
  { arrow: "→", verb: "optimize", note: "copy to exact char limits" },
  { arrow: "→", verb: "push", note: "asc / gplay commands — you approve" },
  { arrow: "→", verb: "verify", note: "rank read back over time ✓", win: true },
] as const;

/** The landing's terminal block: a title bar and the loop as mono lines. */
export function LoopTerminal({ style, testID = "loop-terminal" }: { style?: StyleProp<ViewStyle>; testID?: string }) {
  const palette = usePalette();
  const mono = { fontFamily: typeface.mono, fontSize: fontSize.small } as const;
  return (
    <View
      testID={testID}
      style={[
        { borderRadius: radius.base, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.bg, overflow: "hidden" },
        style,
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderBottomWidth: 1,
          borderBottomColor: palette.lineSoft,
        }}
      >
        {[palette.bad, palette.warn, palette.signal].map((c, i) => (
          <View key={i} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c, opacity: 0.8 }} />
        ))}
        <Text style={{ ...mono, fontSize: fontSize.micro, color: palette.faint, marginLeft: 6 }}>shipaso — the loop</Text>
      </View>
      <View style={{ padding: 12, gap: 6 }}>
        {LOOP_STEPS.map((s) => (
          <View key={s.verb} style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <Text style={{ ...mono, color: palette.signal, width: 14 }}>{s.arrow}</Text>
            <Text style={{ ...mono, color: palette.ink }}>{s.verb}</Text>
            <Text style={{ ...mono, color: "win" in s && s.win ? palette.signal : palette.dim, flex: 1 }} numberOfLines={1}>
              {s.note}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
