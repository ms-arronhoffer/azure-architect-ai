import { BrandVariants, createDarkTheme, createLightTheme } from "@fluentui/react-components";
import type { Theme } from "@fluentui/react-components";

// Azure brand palette — matches Microsoft's primary blue (#0078D4)
const azureBrand: BrandVariants = {
  10: "#020408",
  20: "#061426",
  30: "#092241",
  40: "#0C305D",
  50: "#0F4180",
  60: "#1256A8",
  70: "#1469CC",
  80: "#0078D4",
  90: "#2B88D8",
  100: "#50A6E8",
  110: "#74BCEF",
  120: "#9BD0F5",
  130: "#B9E0FA",
  140: "#D2ECFC",
  150: "#E6F4FD",
  160: "#F3FAFF",
};

export const azureDarkTheme: Theme = {
  ...createDarkTheme(azureBrand),
  // Deep near-black navy — Azure Portal inspired, richer than before
  colorNeutralBackground1: "#070E1A",
  colorNeutralBackground2: "#050C16",
  colorNeutralBackground3: "#0D1B2E",
  colorNeutralBackground4: "#132438",
  colorNeutralBackground5: "#1A3050",
  colorNeutralBackground6: "#213D66",
  colorNeutralStroke1: "rgba(255,255,255,0.08)",
  colorNeutralStroke2: "rgba(255,255,255,0.05)",
  colorNeutralStroke3: "rgba(255,255,255,0.03)",
};

export const azureLightTheme: Theme = {
  ...createLightTheme(azureBrand),
};
