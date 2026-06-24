import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { CostCatalog } from "../../types";

const catalog: CostCatalog = {
  version: 1,
  currency_default: "USD",
  region_default: "eastus",
  services: [
    {
      service: "Virtual Machines",
      label: "Virtual Machines",
      aliases: ["vm", "virtual machine"],
      category: "compute",
      sku_field: "sku",
      ri_eligible: true,
      dimensions: [
        {
          key: "compute",
          label: "Compute hours",
          unit: "hour",
          quantity_field: "__hours__",
          default_quantity: 730,
          included_free: 0,
          required: true,
          instance_scaled: true,
        },
        {
          key: "os_disk",
          label: "OS disk",
          unit: "GB-month",
          quantity_field: "os_disk_gb",
          default_quantity: 128,
          included_free: 0,
          required: false,
          instance_scaled: true,
        },
      ],
    },
  ],
};

// Mock apiFetch so the catalog loads deterministically.
vi.mock("../../config/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path === "/api/cost/catalog") {
      return { ok: true, json: async () => catalog } as Response;
    }
    return { ok: false, json: async () => ({}), text: async () => "" } as Response;
  }),
  apiPath: (p: string) => p,
}));

import CostOptimizePanel from "../CostOptimizePanel";

function wrap(node: React.ReactNode) {
  return <FluentProvider theme={webLightTheme}>{node}</FluentProvider>;
}

describe("CostOptimizePanel - catalog-driven dimensions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders dimension fields for the selected catalog service, skipping __hours__ meters", async () => {
    render(wrap(<CostOptimizePanel />));
    // The default item is "Virtual Machines"; once the catalog loads, its
    // non-special dimension (OS disk) should render, but the __hours__ meter
    // (compute) is folded into the Hours/mo input and must not appear.
    expect(await screen.findByText("OS disk (GB-month)")).toBeInTheDocument();
    expect(screen.queryByText("Compute hours (hour)")).not.toBeInTheDocument();
  });
});
