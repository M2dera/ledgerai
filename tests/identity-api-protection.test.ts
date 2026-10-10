import { describe, expect, it, vi } from "vitest";
import { CompanyPermissionError } from "@/lib/auth/errors";
import { POST as analystPost } from "@/app/api/analyst/route";
import { POST as transactionInterpreterPost } from "@/app/api/transaction-interpreter/route";
import { POST as entryExplanationPost } from "@/app/api/entry-explanation/route";

const permissionMock = vi.hoisted(() => ({ requireCompanyPermission: vi.fn() }));
vi.mock("@/lib/auth/permissions", () => permissionMock);

describe("identity boundary on sensitive APIs", () => {
  it.each([
    ["analyst", analystPost],
    ["transaction interpreter", transactionInterpreterPost],
    ["entry explanation", entryExplanationPost],
  ])("requires a company permission before processing %s requests", async (_label, post) => {
    permissionMock.requireCompanyPermission.mockReset().mockRejectedValue(new CompanyPermissionError("unauthenticated"));
    const response = await post(new Request("http://localhost/api/test", { method: "POST", body: "{}" }));
    expect(permissionMock.requireCompanyPermission).toHaveBeenCalledWith("ai:use");
    expect(response.status).toBe(401);
  });
});
