import { describe, expect, it } from "vitest";
import { describeAuthFailure } from "../authErrors";

const ctx = {
  tenantId: "16b3c013-d300-468d-ac64-7eda0820b6d3",
  clientId: "e9616e6b-3c8b-4153-b814-b01817c9ade2",
  apiScope: "api://5e5c9491-d850-4f1b-9d67-939824a4c819/access_as_user",
};

describe("describeAuthFailure", () => {
  it("explains AADSTS500011 in terms of the missing API resource principal", () => {
    const failure = describeAuthFailure(
      {
        errorCode: "invalid_resource",
        errorMessage:
          "AADSTS500011: The resource principal named api://5e5c9491-d850-4f1b-9d67-939824a4c819 was not found in the tenant named 16b3c013-d300-468d-ac64-7eda0820b6d3.",
      },
      ctx,
    );
    expect(failure).not.toBeNull();
    expect(failure?.code).toBe("invalid_resource");
    expect(failure?.hint).toContain("api://5e5c9491-d850-4f1b-9d67-939824a4c819");
    expect(failure?.hint).toContain(ctx.tenantId);
    expect(failure?.hint).toContain("ensure-entra-apps.sh");
  });

  it("points at the client id when the SPA app is missing", () => {
    const failure = describeAuthFailure(
      { errorCode: "", errorMessage: "AADSTS700016: Application with identifier was not found" },
      ctx,
    );
    expect(failure?.hint).toContain(ctx.clientId);
    expect(failure?.hint).toContain("VITE_ENTRA_CLIENT_ID");
  });

  it("points at redirect URI registration for AADSTS50011", () => {
    const failure = describeAuthFailure(
      { errorCode: "", errorMessage: "AADSTS50011: The redirect URI specified does not match" },
      ctx,
    );
    expect(failure?.hint).toContain("redirect URI");
  });

  it("mentions consent for AADSTS65001", () => {
    const failure = describeAuthFailure(
      { errorCode: "", errorMessage: "AADSTS65001: The user or administrator has not consented" },
      ctx,
    );
    expect(failure?.hint).toContain("Consent");
    expect(failure?.hint).toContain(ctx.apiScope);
  });

  it("returns null when the user closes the popup", () => {
    expect(describeAuthFailure({ errorCode: "user_cancelled", errorMessage: "" }, ctx)).toBeNull();
  });

  it("falls back to a generic hint for unknown errors", () => {
    const failure = describeAuthFailure(new Error("boom"), ctx);
    expect(failure?.code).toBe("unknown_error");
    expect(failure?.message).toBe("boom");
  });
});
