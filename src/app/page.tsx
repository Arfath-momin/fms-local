import { redirect } from "next/navigation";
import { getSession, landingPathFor } from "@/lib/session";

export default async function Home() {
  const session = await getSession();
  redirect(session ? landingPathFor(session.role) : "/login");
}
