import { Platform, Text, type TextProps, type TextStyle } from "react-native";

type IconProps = {
  size?: number;
  color?: string;
  style?: TextStyle;
};

// React Native Web forwards `aria-hidden` to the DOM (see forwardedProps in
// react-native-web), but the native Text types do not declare it, so it rides
// in via a cast. Without it the glyph becomes part of the tab's accessible
// name ("⌂ Home") and exact-name queries fail. Native hides the glyph through
// the props below; the web object is empty there.
const hiddenFromTree = (
  Platform.OS === "web" ? { "aria-hidden": true } : {}
) as unknown as TextProps;

function Glyph({ glyph, size = 22, color, style }: IconProps & { glyph: string }): React.JSX.Element {
  const base: TextStyle = { fontSize: size, lineHeight: size + 2, color, fontWeight: "700", textAlign: "center" };
  return (
    <Text
      {...hiddenFromTree}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={style ? [base, style] : base}
    >
      {glyph}
    </Text>
  );
}

// Zero-dependency tab and banner glyphs. The old lucide set pulled
// react-native-svg plus the whole icon runtime for 8 static marks, and the
// vector-icons replacement bundled 19 font files. Single characters cost
// nothing to download, parse, or render.
export function House(props: IconProps): React.JSX.Element {
  return <Glyph glyph="⌂" {...props} />;
}
export function Inbox(props: IconProps): React.JSX.Element {
  return <Glyph glyph="✉" {...props} />;
}
export function CalendarClock(props: IconProps): React.JSX.Element {
  return <Glyph glyph="◷" {...props} />;
}
export function BellRing(props: IconProps): React.JSX.Element {
  return <Glyph glyph="♪" {...props} />;
}
export function CircleCheck(props: IconProps): React.JSX.Element {
  return <Glyph glyph="✓" {...props} />;
}
export function AlertCircle(props: IconProps): React.JSX.Element {
  return <Glyph glyph="!" {...props} />;
}
export function CheckCircle2(props: IconProps): React.JSX.Element {
  return <Glyph glyph="✓" {...props} />;
}
export function Info(props: IconProps): React.JSX.Element {
  return <Glyph glyph="i" {...props} />;
}
