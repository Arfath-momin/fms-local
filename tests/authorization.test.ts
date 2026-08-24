import "dotenv/config";
import { describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import {
  canAdminister,
  canEdit,
  canEnter,
  canRequestReview,
  canSuperAdminister,
  canViewReports,
  landingPathFor,
} from "@/lib/session";

/**
 * The permission matrix, pinned.
 *
 * These predicates are the whole authorisation model: every guard
 * (requireEntry, requireAdmin, requireSuperAdmin, requireReports) and every
 * piece of UI gating reads one of them, which is what stops a hidden button and
 * a rejected action from disagreeing. That makes them a single point of failure
 * worth pinning cell by cell rather than by spot check.
 *
 * It is not a hypothetical worry. User management sat behind canAdminister()
 * until recently, and that one cell handed every ADMIN two escalations: minting
 * another ADMIN, and — because company grants are edited on the same screen —
 * adding themselves to a company they had never been granted. An admin created
 * for BFM alone could take B2B. A whole-matrix test is how a cell moving back
 * gets noticed by CI instead of by an auditor.
 */

const ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "AUDITOR"];

// Read this as the spec. Each row is one capability, listing exactly the roles
// that hold it; every other role must be refused.
const MATRIX: Record<string, { fn: (r: Role) => boolean; allowed: Role[] }> = {
  "create vouchers and parties": {
    fn: canEnter,
    allowed: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"],
  },
  "change a saved voucher": {
    fn: canEdit,
    allowed: ["SUPER_ADMIN", "ADMIN"],
  },
  "manage centres and retire a master": {
    fn: canAdminister,
    allowed: ["SUPER_ADMIN", "ADMIN"],
  },
  "manage users, un-archive, delete for good": {
    fn: canSuperAdminister,
    allowed: ["SUPER_ADMIN"],
  },
  "read the dashboard and reports": {
    fn: canViewReports,
    allowed: ["SUPER_ADMIN", "ADMIN", "AUDITOR"],
  },
  "raise a review request": {
    fn: canRequestReview,
    allowed: ["ACCOUNTANT"],
  },
};

describe("role permission matrix", () => {
  for (const [capability, { fn, allowed }] of Object.entries(MATRIX)) {
    for (const role of ROLES) {
      const should = allowed.includes(role);
      it(`${role} ${should ? "may" : "may NOT"} ${capability}`, () => {
        expect(fn(role)).toBe(should);
      });
    }
  }
});

describe("the escalations that were actually possible", () => {
  it("does not let an ADMIN reach user management", () => {
    // The exact regression: canAdminister was the gate, and it says yes here.
    expect(canAdminister("ADMIN")).toBe(true);
    expect(canSuperAdminister("ADMIN")).toBe(false);
  });

  it("keeps user management strictly narrower than general administration", () => {
    for (const role of ROLES) {
      if (canSuperAdminister(role)) expect(canAdminister(role)).toBe(true);
    }
  });

  it("never lets a role edit what it cannot enter", () => {
    for (const role of ROLES) {
      if (canEdit(role)) expect(canEnter(role)).toBe(true);
    }
  });

  it("keeps AUDITOR read-only in every direction", () => {
    expect(canEnter("AUDITOR")).toBe(false);
    expect(canEdit("AUDITOR")).toBe(false);
    expect(canAdminister("AUDITOR")).toBe(false);
    expect(canSuperAdminister("AUDITOR")).toBe(false);
    expect(canRequestReview("AUDITOR")).toBe(false);
    // ...but it can read, which is the entire point of the role.
    expect(canViewReports("AUDITOR")).toBe(true);
  });

  it("keeps ACCOUNTANT out of the figures but able to record", () => {
    expect(canEnter("ACCOUNTANT")).toBe(true);
    expect(canEdit("ACCOUNTANT")).toBe(false);
    expect(canViewReports("ACCOUNTANT")).toBe(false);
    // The counterpart to not being able to edit: they can ask for a fix.
    expect(canRequestReview("ACCOUNTANT")).toBe(true);
  });
});

describe("landing page", () => {
  it("never sends a role to a page it will be bounced off", () => {
    for (const role of ROLES) {
      const path = landingPathFor(role);
      if (path === "/dashboard") expect(canViewReports(role)).toBe(true);
      else expect(path).toBe("/vouchers");
    }
  });
});
