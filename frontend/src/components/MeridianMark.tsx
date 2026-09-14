import { Image } from "react-native";

// Brand mark — approved brass-on-transparent artwork (assets/mark.svg
// is the source, assets/mark.png the export). PNG keeps the exact
// approved pixels with no extra dependency.
export function MeridianMark({ size = 16 }: { size?: number }) {
  return (
    <Image
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      source={require("../../assets/mark.png")}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}
