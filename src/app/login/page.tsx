import { Boxes, ClipboardCheck, ShieldCheck, Warehouse } from "lucide-react";
import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const HIGHLIGHTS = [
  { icon: Warehouse, text: "Real-time stock across all warehouses" },
  { icon: ClipboardCheck, text: "Purchasing, sales and transfer workflows" },
  { icon: ShieldCheck, text: "Every stock change audited — nothing goes negative" },
];

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = firstParam(params.next);
  const signedOut = firstParam(params.signedOut) === "1";

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand-600">
            <Boxes aria-hidden className="size-5" />
          </span>
          <span className="text-lg font-semibold">
            StockFlow <span className="font-normal text-sidebar-muted">ERP</span>
          </span>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl leading-tight font-semibold">Inventory and warehouse operations, in one place.</h1>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-slate-300">
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/10">
                  <Icon aria-hidden className="size-4 text-brand-200" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-sidebar-muted">Internal system · Authorised personnel only</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand-600">
              <Boxes aria-hidden className="size-5 text-white" />
            </span>
            <span className="text-lg font-semibold">StockFlow ERP</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use the account provided by your administrator.</p>
          <div className="mt-8">
            <LoginForm next={next} signedOut={signedOut} />
          </div>
        </div>
      </section>
    </div>
  );
}
