import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm border border-line-strong bg-surface shadow-sm">
        <div className="border-b border-line px-6 py-5">
          <h1 className="heading text-xl font-semibold">FMS</h1>
          <p className="text-muted text-[13px] mt-1">
            Fish merchant management — BFM / B2B
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
