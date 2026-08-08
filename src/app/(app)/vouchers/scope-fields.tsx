import { SCOPE_CENTRE_FIELD, SCOPE_COMPANY_FIELD, type FormScope } from "@/lib/scope";

/**
 * Pins an entry form to the company and centre it was rendered under. Every
 * voucher form renders this; every create action checks it. See lib/scope.ts
 * for why.
 */
export function ScopeFields({ scope }: { scope: FormScope }) {
  return (
    <>
      <input type="hidden" name={SCOPE_COMPANY_FIELD} value={scope.companyId} />
      <input type="hidden" name={SCOPE_CENTRE_FIELD} value={scope.centreId} />
    </>
  );
}
