import { Suspense } from "react";
import { Workbench } from "./workbench";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<p className="text-sm text-text-mute">Opening the guard file…</p>}>
      <Workbench id={id} />
    </Suspense>
  );
}
