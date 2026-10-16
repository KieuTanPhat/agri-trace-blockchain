import { Text, type TextProps } from "react-native";

import { useTheme } from "../theme/ThemeProvider";
import type { ColorName, TypeStyleName } from "../theme/tokens";

type Props = TextProps & { variant?: TypeStyleName; color?: ColorName };

/** Text set in a design-system type style; defaults to `body` in `ink`. */
export function AppText({ variant = "body", color = "ink", style, ...rest }: Props) {
  const theme = useTheme();
  return <Text {...rest} style={[theme.type[variant], { color: theme.colors[color] }, style]} />;
}
