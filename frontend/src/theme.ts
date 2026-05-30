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
  // Deep navy backgrounds — Azure Portal dark mode inspired
  colorNeutralBackground1: "#0E1E33",
  colorNeutralBackground2: "#091628",
  colorNeutralBackground3: "#152B44",
  colorNeutralBackground4: "#1C3A58",
  colorNeutralBackground5: "#1F4168",
  colorNeutralBackground6: "#244878",
  colorNeutralStroke1: "#1E334E",
  colorNeutralStroke2: "#182A3E",
  colorNeutralStroke3: "#132236",
};

export const azureLightTheme: Theme = {
  ...createLightTheme(azureBrand),
};
