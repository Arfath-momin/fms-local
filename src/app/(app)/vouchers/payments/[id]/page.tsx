import { SettlementDetailPage } from "../../settlements/views";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SettlementDetailPage kind="PAYMENT" id={id} />;
}
