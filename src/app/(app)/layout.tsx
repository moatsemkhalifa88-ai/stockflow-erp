import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AccountBlocked } from "@/components/auth/account-blocked";
import { AppShell } from "@/components/layout/app-shell";
import { getSession } from "@/lib/auth/session";

/** Every page inside (app) requires an active user with a valid role. */
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (session.status === "anonymous") redirect("/login");
  if (session.status === "no_profile") {
    return (
      <AccountBlocked
        title="No profile found"
        description={`The account ${session.email} has no StockFlow profile or role. Ask an administrator to set it up.`}
      />
    );
  }
  if (session.status === "inactive") {
    return (
      <AccountBlocked
        title="Account deactivated"
        description="Your account has been deactivated. Contact an administrator if you believe this is a mistake."
      />
    );
  }

  const { user } = session;
  return (
    <AppShell user={{ fullName: user.fullName, email: user.email, role: user.role, roleName: user.roleName }}>
      {children}
    </AppShell>
  );
}
