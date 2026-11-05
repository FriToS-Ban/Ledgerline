import { Suspense } from "react";
import { Workbench } from "./workbench";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<p className="text-sm text-[#4B5963]">Loading case…</p>}>
      <Workbench id={id} />
    </Suspense>
  );
}
