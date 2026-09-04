import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { s, MUTED, RULE_STRONG } from "./theme";
import type { Letterhead } from "./letterhead";

/**
 * Every printable voucher, as one document.
 *
 * A sale bill, a purchase, a delivery note and a party statement are the same
 * shape: a banded head, who it concerns, a table of rows, a block of figures
 * under it, and somewhere to sign. Building four documents would have meant
 * four places to fix a margin and four chances for two of them to disagree —
 * and two definitions of one document drifting apart is the fault that has cost
 * this codebase the most.
 *
 * Each voucher's route decides WHAT to say. This decides how it looks.
 *
 * Every figure arrives PRE-FORMATTED as a string. Nothing here does arithmetic
 * or rounding, so a document and the screen it came from cannot disagree about
 * a rupee.
 */

export type Column = {
  label: string;
  /** Fixed width in points, or a flex share when absent. */
  width?: number;
  flex?: number;
  align?: "left" | "right";
};

export type WorkingRow = {
  label: string;
  value: string;
  /** Draws a rule above this row — used before a total. */
  rule?: boolean;
  strong?: boolean;
};

export type VoucherDoc = {
  /** The mark, the legal name, the address and the GSTIN. */
  letterhead: Letterhead;
  centreName: string;
  docKind: string;
  /** Bill number, dates — whatever identifies this document. */
  identity: { label: string; value: string }[];
  /** "Billed to", "Bought from", "Statement of" … */
  partyTitle: string;
  partyName: string;
  partySub: string | null;
  details: { label: string; value: string }[];

  columns: Column[];
  rows: string[][];
  /** The table's own total line, aligned to the same columns. */
  totalRow: string[] | null;

  working: WorkingRow[];
  amountInWords: string | null;
  footNote: string | null;
  notes: string | null;
  signLeft: string | null;
  signRight: string | null;
  /**
   * The last sheet the rows reach, so column headings stop there.
   *
   * Estimated from the row count, never measured: react-pdf lays out after this
   * component is built, so nothing here can ask how tall the table came out.
   * The two ways of being wrong are not equal — a stray heading on a sheet with
   * no rows is untidy, missing headings on a sheet that HAS rows leaves the
   * reader guessing which column is which — so callers estimate generously.
   */
  lastItemPage: number;
};

/**
 * One cell's box.
 *
 * A right-aligned column gets padding on BOTH sides. A rupee figure in Indian
 * grouping is long — ₹16,16,001.00 is thirteen characters — and with padding on
 * one side only, a column just wide enough for it ends flush against the number
 * to its left. On a statement of a month's trading that is three columns of
 * figures running into each other, which is what was reported.
 */
const cell = (c: Column) => ({
  ...(c.width ? { width: c.width } : { flex: c.flex ?? 1 }),
  textAlign: (c.align ?? "left") as "left" | "right",
  paddingRight: 8,
  ...(c.align === "right" ? { paddingLeft: 8 } : {}),
});

export function VoucherDocument({ d }: { d: VoucherDoc }) {
  return (
    <Document
      title={`${d.letterhead.name} · ${d.docKind}`}
      author={d.letterhead.name}
    >
      <Page size="A4" style={s.page}>
        {/* Repeated on every sheet: a loose second page of a bill has to say
            which bill it belongs to. */}
        <View style={s.band} fixed>
          <View style={s.bandSide}>
            <Text style={s.docKind}>{d.docKind.toUpperCase()}</Text>
            <Text style={{ marginTop: 2 }}>{d.centreName}</Text>
          </View>
          <View style={s.bandCentre}>
            {d.letterhead.logo ? (
              // Bounded rather than sized: logos arrive square, wide or tall,
              // and `objectFit: contain` keeps whichever it is inside the band
              // without stretching it into something a client would not
              // recognise on their own paperwork.
              /* eslint-disable-next-line jsx-a11y/alt-text --
                 this is react-pdf's Image, which draws into a PDF and has no
                 alt attribute to give; the rule is looking for an HTML <img>. */
              <Image
                src={d.letterhead.logo}
                style={{ height: 40, maxWidth: 150, objectFit: "contain" }}
              />
            ) : (
              // No mark uploaded — the short name fills the space one would
              // have, which is why it is `name` and not the legal name.
              <Text style={s.companyMark}>{d.letterhead.name}</Text>
            )}
            {d.letterhead.legalName && d.letterhead.logo && (
              <Text style={[s.companyLine, { fontWeight: "bold", marginTop: 2 }]}>
                {d.letterhead.legalName}
              </Text>
            )}
            {/* An Indian address collapsed onto one line is unreadable, so the
                lines it was typed on are kept. */}
            {d.letterhead.address && (
              <Text style={s.companyLine}>{d.letterhead.address}</Text>
            )}
            {d.letterhead.contact && (
              <Text style={s.companyLine}>{d.letterhead.contact}</Text>
            )}
          </View>
          <View style={s.bandRight}>
            {d.identity.map((x) => (
              <Text key={x.label}>
                <Text style={{ color: MUTED }}>{x.label} </Text>
                <Text style={s.strong}>{x.value}</Text>
              </Text>
            ))}
          </View>
        </View>

        <View style={{ flexDirection: "row", marginBottom: 4 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{d.partyTitle.toUpperCase()}</Text>
            <Text style={{ fontSize: 11, fontWeight: "bold", marginTop: 2 }}>
              {d.partyName}
            </Text>
            {d.partySub && (
              <Text style={{ color: MUTED, marginTop: 1 }}>{d.partySub}</Text>
            )}
          </View>
          <View style={[s.details, { flex: 1 }]}>
            {d.details.map((x) => (
              <View style={s.detailRow} key={x.label}>
                <Text style={s.detailLabel}>{x.label}</Text>
                <Text style={s.strong}>{x.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {d.rows.length > 0 && (
          <>
            <View
              style={s.th}
              fixed
              render={({ pageNumber }: { pageNumber: number }) =>
                pageNumber <= d.lastItemPage ? (
                  <>
                    {d.columns.map((c) => (
                      <Text key={c.label} style={[s.thText, cell(c)]}>
                        {c.label.toUpperCase()}
                      </Text>
                    ))}
                  </>
                ) : null
              }
            />
            {d.rows.map((row, i) => (
              <View style={s.tr} key={i} wrap={false}>
                {row.map((v, j) => (
                  <Text key={j} style={cell(d.columns[j])}>
                    {v}
                  </Text>
                ))}
              </View>
            ))}
            {d.totalRow && (
              <View style={s.tfoot}>
                {d.totalRow.map((v, j) => (
                  <Text key={j} style={[cell(d.columns[j]), s.strong]}>
                    {v}
                  </Text>
                ))}
              </View>
            )}
          </>
        )}

        {/* The foot travels as one block. It split across the page break once:
            "AMOUNT IN WORDS" at the bottom of a sheet with the words at the top
            of the next, and totals separated from the signatures that attest to
            them. A figure on a page without its label is how a total gets
            disputed. */}
        <View wrap={false}>
          {d.working.length > 0 && (
            <View style={s.totals}>
              {d.working.map((w) => (
                <View key={w.label}>
                  {w.rule && <View style={s.totalRule} />}
                  <View style={s.totalRow}>
                    <Text style={w.strong ? s.strong : { color: MUTED }}>
                      {w.label}
                    </Text>
                    <Text style={w.strong ? s.strong : undefined}>
                      {w.value}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {d.amountInWords && (
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: RULE_STRONG,
                marginTop: 14,
                paddingTop: 6,
              }}
            >
              <Text style={s.label}>AMOUNT IN WORDS</Text>
              <Text style={{ marginTop: 2 }}>{d.amountInWords}</Text>
            </View>
          )}

          {d.footNote && <Text style={{ marginTop: 8 }}>{d.footNote}</Text>}

          {d.notes && (
            <View style={{ marginTop: 10 }}>
              <Text style={s.label}>NOTES</Text>
              <Text style={{ marginTop: 2 }}>{d.notes}</Text>
            </View>
          )}

          {(d.signLeft || d.signRight) && (
            <View style={s.sign}>
              <Text style={s.signBox}>{d.signLeft ?? " "}</Text>
              <Text style={s.signBox}>{d.signRight ?? " "}</Text>
            </View>
          )}
        </View>

        <Text
          style={s.pageNo}
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : ""
          }
          fixed
        />
      </Page>
    </Document>
  );
}

/** Sheets the rows will reach. See the note on lastItemPage. */
export const sheetsFor = (rowCount: number) =>
  Math.max(1, Math.ceil(rowCount / 34));
