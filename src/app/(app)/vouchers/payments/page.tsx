import { SettlementListPage } from "../settlements/views";
import type { SearchParams } from "@/lib/paging";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <SettlementListPage kind="PAYMENT" searchParams={searchParams} />;
}
