import { Boxes } from "lucide-react";
import type { Metadata } from "next";
import { DemoAccountPicker } from "./demo-account-picker";
import { OwnAccountSignIn } from "./own-account-sign-in";

export const metadata: Metadata = { title: "Sign in" };

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = firstParam(params.next);
  const signedOut = firstParam(params.signedOut) === "1";

  return (
    <main className="flex min-h-dvh justify-center bg-gradient-to-b from-white to-slate-100 px-4 py-10 sm:items-center sm:py-16">
      <div className="w-full min-w-0 max-w-[440px] sm:max-w-[600px]">
        <div className="flex items-center justify-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand-600">
            <Boxes aria-hidden className="size-5 text-white" />
          </span>
          <span className="text-lg font-semibold text-slate-900">
            StockFlow <span className="font-normal text-slate-500">ERP</span>
          </span>
        </div>

        <div className="mt-8 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold tracking-[0.02em] text-brand-700 uppercase ring-1 ring-brand-100 ring-inset">
            <span aria-hidden className="size-1.5 rounded-full bg-brand-500" />
            Demo environment
          </span>
          <h1 className="mt-4 text-heading-xl tracking-tight text-slate-900">Choose a demo account</h1>
          <p className="mt-2 text-body-md text-slate-600">Tap any card to sign in instantly</p>
        </div>

        <div className="mt-8">
          <DemoAccountPicker next={next} />
        </div>

        <div className="my-8 flex items-center gap-3 text-xs font-medium tracking-[0.02em] text-slate-500 uppercase">
          <span aria-hidden className="h-px flex-1 bg-slate-200" />
          or
          <span aria-hidden className="h-px flex-1 bg-slate-200" />
        </div>

        <OwnAccountSignIn next={next} signedOut={signedOut} />

        <p className="mt-10 text-center text-xs text-slate-500">Sample data only · Each role sees what it is allowed to change</p>
      </div>
    </main>
  );
}
