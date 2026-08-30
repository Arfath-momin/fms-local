import { Document, Page, Text, View } from "@react-pdf/renderer";
import { s, MUTED } from "./theme";

/**
 * A market sale bill, as a PDF.
 *
 * Everything the printable HTML page shows, in the order the market's own paper
 * reads it — total, then each thing they took off, then the net, then what they
 * have already paid against it and what is still owed.
 *
 * All figures arrive PRE-FORMATTED as strings. This component does no
 * arithmetic and no rounding: the route hands it the same values the screen
 * shows, so a bill and its PDF can never disagree about a rupee.
 */

export type MarketBillData = {
  companyName: string;
  centreName: string;
  billNo: string;
  saleDate: string;
  purchaseDate: string;
  partyName: string;
  careOfName: string | null;
  /** Label/value pairs — place, vehicle, whatever the bill carries. */
  details: { label: string; value: string }[];
  lines: { particular: string; box: string }[];
  totalBoxes: string;
  /** The deductions, in the order they are struck. Empty ones are omitted. */
  working: { label: string; value: string }[];
  netBill: string;
  /** What the market handed the driver, when it did. */
  receipt: { label: string; value: string; owed: string } | null;
  amountInWords: string;
  outstanding: string | null;
  notes: string | null;
};

export function MarketBillDocument({ d }: { d: MarketBillData }) {
  return (
    <Document
      title={`${d.companyName} · Market Sale Bill ${d.billNo}`}
      author={d.companyName}
    >
      <Page size="A4" style={s.page}>
        <View style={s.band} fixed>
          <View style={s.bandSide}>
            <Text style={s.docKind}>MARKET SALE BILL</Text>
            <Text style={{ marginTop: 2 }}>{d.centreName}</Text>
          </View>
          <View style={s.bandCentre}>
            <Text style={s.companyMark}>{d.companyName}</Text>
          </View>
          <View style={s.bandRight}>
            <Text>
              <Text style={{ color: MUTED }}>No. </Text>
              <Text style={s.strong}>{d.billNo}</Text>
            </Text>
            <Text>
              <Text style={{ color: MUTED }}>Date </Text>
              <Text style={s.strong}>{d.saleDate}</Text>
            </Text>
            {/* Always, even when it matches the sale date. A reader seeing one
                date cannot tell whether they agreed or whether the bill simply
                does not say, and removing that doubt is the point. */}
            <Text style={{ fontSize: 8 }}>
              <Text style={{ color: MUTED }}>Purchase date </Text>
              <Text style={s.strong}>{d.purchaseDate}</Text>
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", marginBottom: 4 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>BILLED TO</Text>
            <Text style={{ fontSize: 11, fontWeight: "bold", marginTop: 2 }}>
              {d.partyName}
            </Text>
            {d.careOfName && (
              <Text style={{ color: MUTED, marginTop: 1 }}>
                c/o {d.careOfName}
              </Text>
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

        {/* Items. A market bill is itemised in BOXES: its money is the net the
            market paid, not a rate times a weight, so a Kgs column would print
            zeros and invite the reader to multiply them. */}
        <View style={s.th} fixed>
          <Text style={[s.thText, { width: 34, textAlign: "right" }]}>SR NO</Text>
          <Text style={[s.thText, { flex: 1, paddingLeft: 10 }]}>PARTICULARS</Text>
          <Text style={[s.thText, { width: 60, textAlign: "right" }]}>BOX</Text>
        </View>
        {d.lines.map((l, i) => (
          <View style={s.tr} key={i} wrap={false}>
            <Text style={{ width: 34, textAlign: "right", color: MUTED }}>
              {i + 1}
            </Text>
            <Text style={{ flex: 1, paddingLeft: 10 }}>{l.particular}</Text>
            <Text style={{ width: 60, textAlign: "right" }}>{l.box}</Text>
          </View>
        ))}
        <View style={s.tfoot}>
          <Text style={{ flex: 1, textAlign: "right", fontWeight: "bold" }}>
            Total
          </Text>
          <Text style={{ width: 60, textAlign: "right", fontWeight: "bold" }}>
            {d.totalBoxes}
          </Text>
        </View>

        <View style={s.totals}>
          {d.working.map((w) => (
            <View style={s.totalRow} key={w.label}>
              <Text style={{ color: MUTED }}>{w.label}</Text>
              <Text>{w.value}</Text>
            </View>
          ))}
          <View style={s.totalRule} />
          <View style={s.totalRow}>
            <Text style={s.strong}>Net bill</Text>
            <Text style={s.strong}>{d.netBill}</Text>
          </View>
          {d.receipt && (
            <>
              <View style={s.totalRow}>
                <Text style={{ color: MUTED }}>{d.receipt.label}</Text>
                <Text>{d.receipt.value}</Text>
              </View>
              <View style={s.totalRule} />
              <View style={s.totalRow}>
                <Text style={s.strong}>Still owed on this bill</Text>
                <Text style={s.strong}>{d.receipt.owed}</Text>
              </View>
            </>
          )}
        </View>

        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: "#8a9099",
            marginTop: 14,
            paddingTop: 6,
          }}
        >
          <Text style={s.label}>AMOUNT IN WORDS</Text>
          <Text style={{ marginTop: 2 }}>{d.amountInWords}</Text>
        </View>

        {d.outstanding && (
          <Text style={{ marginTop: 8 }}>
            <Text style={{ color: MUTED }}>
              Total outstanding for {d.careOfName ?? d.partyName} across all
              bills:{" "}
            </Text>
            <Text style={s.strong}>{d.outstanding}</Text>
          </Text>
        )}

        {d.notes && (
          <View style={{ marginTop: 10 }}>
            <Text style={s.label}>NOTES</Text>
            <Text style={{ marginTop: 2 }}>{d.notes}</Text>
          </View>
        )}

        <View style={s.sign}>
          <Text style={s.signBox}>RECEIVER&apos;S SIGNATURE</Text>
          <Text style={s.signBox}>FOR {d.companyName.toUpperCase()}</Text>
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
