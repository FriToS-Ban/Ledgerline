import { describe, expectTypeOf, it } from "vitest";
import { computeAccuracy } from "@/lib/accuracy";
import { approvalLimit, changeMemberRole, listOrgMembers } from "@/lib/auth/users";
import { loadCorrections, loadFx, loadHistory, loadOpenPos, loadPolicy, vendorApproved } from "@/lib/domain";
import { loadFridayInbox } from "@/lib/demo/friday";
import { ingestRawEmail } from "@/lib/email/ingest";
import { pollMailbox } from "@/lib/email/imap";
import { importMaster } from "@/lib/master/import";
import { syncErpIfDue, syncFromErp } from "@/lib/master/erp";
import { syncMasterFolder } from "@/lib/master/sync";
import { computeMetrics } from "@/lib/metrics";
import { createInvoiceRecord, processCase, resumeCase } from "@/lib/process-case";
import { enqueue, queueStats, retryDead } from "@/lib/queue/jobs";
import { seedDatabase, seedOrgDefaults } from "@/lib/db/seed";

describe("data-access functions take the org as an explicit argument", () => {
  it("has orgId as the first parameter", () => {
    expectTypeOf(loadPolicy).parameter(0).toBeString();
    expectTypeOf(loadOpenPos).parameter(0).toBeString();
    expectTypeOf(loadHistory).parameter(0).toBeString();
    expectTypeOf(loadFx).parameter(0).toBeString();
    expectTypeOf(vendorApproved).parameters.toEqualTypeOf<[orgId: string, name: string]>();
    expectTypeOf(loadCorrections).parameters.toEqualTypeOf<[orgId: string, fingerprint: string]>();
    expectTypeOf(computeMetrics).parameters.toEqualTypeOf<[orgId: string]>();
    expectTypeOf(computeAccuracy).parameters.toEqualTypeOf<[orgId: string]>();
    expectTypeOf(queueStats).parameters.toEqualTypeOf<[orgId: string]>();
    expectTypeOf(retryDead).parameter(0).toBeString();
    expectTypeOf(enqueue).parameter(0).toBeString();
    expectTypeOf(importMaster).parameter(0).toBeString();
    expectTypeOf(syncFromErp).parameters.toEqualTypeOf<[orgId: string]>();
    expectTypeOf(syncErpIfDue).parameters.toEqualTypeOf<[orgId: string]>();
    expectTypeOf(syncMasterFolder).parameters.toEqualTypeOf<[orgId: string]>();
    expectTypeOf(pollMailbox).parameters.toEqualTypeOf<[orgId: string]>();
    expectTypeOf(ingestRawEmail).parameter(0).toBeString();
    expectTypeOf(loadFridayInbox).parameters.toEqualTypeOf<[orgId: string]>();
    expectTypeOf(seedOrgDefaults).parameters.toEqualTypeOf<[orgId: string]>();
    expectTypeOf(seedDatabase).parameter(0).toBeString();
    expectTypeOf(listOrgMembers).parameters.toEqualTypeOf<[orgId: string]>();
    expectTypeOf(changeMemberRole).parameter(0).toBeString();
    expectTypeOf(approvalLimit).parameter(0).toBeString();
  });

  it("requires orgId in the options of case operations", () => {
    expectTypeOf<Parameters<typeof processCase>[0]>().toHaveProperty("orgId").toBeString();
    expectTypeOf<Parameters<typeof resumeCase>[0]>().toHaveProperty("orgId").toBeString();
    expectTypeOf<Parameters<typeof createInvoiceRecord>[0]>().toHaveProperty("orgId").toBeString();
  });
});
