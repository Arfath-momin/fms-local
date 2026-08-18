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
 * The banded header at the top of every printed document.
 *
 * Three zones, fixed across every document type so a merchant handling a stack
 * of them can find the same fact in the same place every time:
 *
 *   left    the centre the document belongs to, and what kind of document it is
 *   centre  the company's mark — its logo, or its short name when none is set
 *   right   the document's own identity: bill number and date
 *
 * The mark sits in the middle rather than the corner because it is the only
 * part a client recognises at a glance across a desk; the two corners carry the
 * text you go looking for deliberately.
 *
 * Shared by every print page so a buyer receiving a bill and a delivery note
 * recognises them as coming from the same business — two documents with
 * different heads read as two suppliers.
 *
 * Every company field below the mark is optional and simply omitted when unset.
 * A company created a minute ago, before anyone has gathered its GSTIN, still
 * prints a usable document with its name alone; the alternative would be
 * blocking the Companies form on paperwork nobody has to hand yet.
 */
export function PrintHeader({
  company,
  centreName,
  docKind,
  right,
}: {
  company: LetterheadCompany;
  centreName: string;
  /** What kind of document this is — "Purchase", "Delivery Note", … */
  docKind: string;
  /** The document's own identity: bill number, date, period. */
  right: React.ReactNode;
}) {
  const contact = [
    company.phone && `Ph: ${company.phone}`,
    company.email,
    company.gstin && `GSTIN: ${company.gstin}`,
  ].filter(Boolean) as string[];

  return (
    <div className="bill-band">
      <div className="bill-band-left">
        <div className="text-[12px] opacity-75 leading-tight">
          {centreName}
        </div>
        <div className="doc-kind mt-0.5">{docKind}</div>
      </div>

      <div className="bill-band-centre">
        {company.logoKey ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/company-logo/${company.id}`}
            alt={companyDisplayName(company)}
            /* Bounded rather than sized: logos arrive square, wide or tall, and
               object-contain keeps whichever it is inside the band without
               stretching it into something the client would not recognise. */
            className="h-16 max-w-[200px] object-contain mx-auto"
          />
        ) : (
          /* No logo uploaded — the short name stands in as the mark, which is
             why it is `name` and not companyDisplayName(): "BFM" is what fills
             the space a logo would have, where the full legal name would not. */
          <div className="heading text-2xl font-bold leading-tight">
            {company.name}
          </div>
        )}

        {/* Kept under the mark rather than dropped: a sale bill without a GSTIN
            is not a document a buyer can file, and the address is what makes it
            a letterhead rather than a slip of paper. */}
        {company.legalName && company.logoKey && (
          <div className="text-[12px] font-semibold mt-1 leading-tight">
            {company.legalName}
          </div>
        )}
        {company.address && (
          /* whitespace-pre-line: the address was typed as separate lines in a
             textarea, and an Indian address collapsed onto one is unreadable. */
          <div className="text-[11px] opacity-85 whitespace-pre-line leading-snug mt-0.5">
            {company.address}
          </div>
        )}
        {contact.length > 0 && (
          <div className="text-[11px] opacity-85 leading-snug">
            {contact.join("  ·  ")}
          </div>
        )}
      </div>

      <div className="bill-band-right">{right}</div>
    </div>
  );
}
