import { companyDisplayName } from "@/lib/company-theme";

export type LetterheadCompany = {
  id: string;
  name: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  logoKey: string | null;
};

/**
 * The company block at the top of every printed voucher.
 *
 * Shared by the sale bill and the delivery note so a buyer receiving both
 * recognises them as coming from the same business — two documents with
 * different heads read as two suppliers.
 *
 * Every field below the name is optional and simply omitted when unset. A
 * company created a minute ago, before anyone has gathered its GSTIN, still
 * prints a usable document with its name alone; the alternative would be
 * blocking the Companies form on paperwork nobody has to hand yet.
 */
export function Letterhead({
  company,
  centreName,
}: {
  company: LetterheadCompany;
  centreName: string;
}) {
  const lines = [
    company.phone && `Ph: ${company.phone}`,
    company.email,
    company.gstin && `GSTIN: ${company.gstin}`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex items-start gap-3">
      {company.logoKey && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`/api/company-logo/${company.id}`}
          alt=""
          /* Bounded rather than sized: logos arrive square, wide or tall, and
             object-contain keeps whichever it is inside the band without
             stretching it into something the client would not recognise. */
          className="h-14 w-14 object-contain shrink-0"
        />
      )}
      <div className="min-w-0">
        <div className="heading text-2xl font-bold leading-tight">
          {companyDisplayName(company)}
        </div>
        {company.address && (
          /* whitespace-pre-line: the address was typed as separate lines in a
             textarea, and an Indian address collapsed onto one is unreadable. */
          <div className="text-[12px] opacity-85 whitespace-pre-line leading-snug">
            {company.address}
          </div>
        )}
        {lines.length > 0 && (
          <div className="text-[12px] opacity-85">{lines.join("  ·  ")}</div>
        )}
        <div className="text-[12px] opacity-70">{centreName}</div>
      </div>
    </div>
  );
}
