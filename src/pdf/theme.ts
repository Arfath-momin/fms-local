import path from "node:path";
import { Font, StyleSheet } from "@react-pdf/renderer";

/**
 * The look every generated PDF shares.
 *
 * These documents are built as PDFs rather than by photographing an HTML page,
 * so nothing here reads the app's CSS. That is the trade: one more place a
 * document is described, in exchange for a renderer that needs no browser —
 * 320 KB and ~20 MB of memory against Chromium's 200 MB image and quarter of a
 * gigabyte per render, on a server with a single core shared with Postgres.
 *
 * THE FONT IS BUNDLED, deliberately.
 *
 * The PDF standard's built-in faces have no ₹ glyph — every rupee figure on a
 * fish merchant's bill would print as a hollow box. DejaVu Sans has it, and its
 * Bitstream Vera licence permits redistribution (see the licence beside it). It
 * ships in the repo rather than being fetched at build or run time: a font
 * downloaded on the server is one more thing that can fail there and nowhere
 * else, on the day a bill is needed.
 *
 * It lives under public/ for a deployment reason, not a serving one. These
 * files are read from disk at render time by PATH, and Next's standalone output
 * copies only the files its build trace can see — a path built at runtime is
 * invisible to that trace, so fonts kept beside this module would exist in
 * development and be missing from the container. public/ is copied wholesale by
 * the Dockerfile, which makes the path true in both places.
 */
const FONT_DIR = path.join(process.cwd(), "public", "fonts");

Font.register({
  family: "DejaVu",
  fonts: [
    { src: path.join(FONT_DIR, "DejaVuSans.ttf"), fontWeight: "normal" },
    { src: path.join(FONT_DIR, "DejaVuSans-Bold.ttf"), fontWeight: "bold" },
  ],
});

// react-pdf hyphenates across line breaks by default, which turns a party name
// into "Karava-li Fishmeal" on a bill. Nothing here is prose.
Font.registerHyphenationCallback((word) => [word]);

export const INK = "#1a1a1a";
export const MUTED = "#5c6672";
export const RULE = "#c9ccd1";
export const RULE_STRONG = "#8a9099";

export const s = StyleSheet.create({
  page: {
    fontFamily: "DejaVu",
    fontSize: 9,
    color: INK,
    backgroundColor: "#ffffff",
    paddingTop: 32,
    paddingBottom: 44,
    paddingHorizontal: 34,
  },

  // --- the banded head, in the same three zones as the screen version, so a
  // merchant holding a stack of documents finds the same fact in the same place
  band: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderBottomWidth: 1.5,
    borderBottomColor: RULE_STRONG,
    paddingBottom: 8,
    marginBottom: 12,
  },
  bandSide: { flex: 1 },
  bandCentre: { flex: 1, alignItems: "center" },
  bandRight: { flex: 1, alignItems: "flex-end" },

  docKind: { fontSize: 7.5, letterSpacing: 1.1, color: MUTED },
  companyMark: { fontSize: 15, fontWeight: "bold" },
  companyLine: { fontSize: 7.5, color: MUTED, textAlign: "center" },

  label: { fontSize: 7.5, letterSpacing: 0.6, color: MUTED },
  strong: { fontWeight: "bold" },

  // --- label / value pairs, right-aligned as a block. Same reasoning as the
  // HTML version: labels tight against their values, not thrown to the margins
  details: { alignItems: "flex-end" },
  detailRow: { flexDirection: "row", marginBottom: 1.5 },
  detailLabel: { color: MUTED, textAlign: "right", marginRight: 6 },

  // --- tables
  th: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: RULE_STRONG,
    paddingBottom: 4,
    marginTop: 10,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
    // Tight enough that an ordinary bill stays on one sheet, loose enough to
    // read down a column of forty without losing your place — and a statement
    // of a month's trading is exactly that, read down.
    paddingVertical: 3.5,
  },
  tfoot: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: RULE_STRONG,
    paddingTop: 4,
    marginTop: -0.5,
  },
  thText: { fontSize: 7.5, letterSpacing: 0.5, color: MUTED },
  r: { textAlign: "right" },

  // --- the bill's working, a narrow block against the right margin
  totals: { marginTop: 10, marginLeft: "auto", width: 230 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2.5,
  },
  totalRule: { borderTopWidth: 1, borderTopColor: RULE_STRONG, marginTop: 2 },

  sign: {
    flexDirection: "row",
    justifyContent: "space-between",
    // Enough air to sign in, not so much that an otherwise one-page bill is
    // pushed onto a second sheet by whitespace alone.
    marginTop: 30,
  },
  signBox: {
    width: 150,
    borderTopWidth: 1,
    borderTopColor: RULE_STRONG,
    paddingTop: 3,
    fontSize: 7.5,
    color: MUTED,
    textAlign: "center",
  },

  // Printed at the foot of every page, so a bill that runs to two sheets says
  // so — a single loose page of a two-page bill is how a total gets disputed.
  pageNo: {
    position: "absolute",
    bottom: 22,
    left: 34,
    right: 34,
    textAlign: "center",
    fontSize: 7.5,
    color: MUTED,
  },
});
