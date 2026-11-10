import { describe, expect, it } from "vitest";
import { passwordProblem } from "../passwords";
import { registerSchema } from "../schemas";

describe("password rules", () => {
  it("accepts a long, uncommon password", () => {
    expect(passwordProblem("correct horse battery")).toBeNull();
    expect(passwordProblem("Tq9!vL2#pZ8w")).toBeNull();
  });

  it("requires 10..128 characters", () => {
    expect(passwordProblem("Sh0rt!pw")).toMatch(/at least 10/);
    expect(passwordProblem("x".repeat(60) + "Yz9!".repeat(20))).toMatch(/at most 128/);
  });

  it("refuses common passwords, including dressed-up variants", () => {
    for (const pw of ["password123", "Password2026!", "qwertyuiop", "1234567890", "iloveyou1234", "P@ssw0rd2026", "ledgerline"]) {
      expect(passwordProblem(pw), pw).not.toBeNull();
    }
  });

  it("refuses repeats, runs and too few distinct characters", () => {
    expect(passwordProblem("aaaaaaaaaaaa")).not.toBeNull();
    expect(passwordProblem("abababababab")).not.toBeNull();
    expect(passwordProblem("abcdefghijkl")).not.toBeNull();
    expect(passwordProblem("0987654321")).not.toBeNull();
  });

  it("refuses passwords built from the email or name", () => {
    expect(passwordProblem("jordansmith-2026", { email: "jordansmith@corp.io" })).toMatch(/email/);
    expect(passwordProblem("RobinBanks-vault", { name: "Robin Banks" })).toMatch(/name/);
  });

  it("validates and normalizes registration input", () => {
    const ok = registerSchema.safeParse({ email: "  New.User@Corp.IO ", name: " New User ", password: "violet-anchor-77" });
    expect(ok.success && ok.data).toEqual({ email: "new.user@corp.io", name: "New User", password: "violet-anchor-77" });
    const bad = registerSchema.safeParse({ email: "not-an-email", name: "", password: "password123" });
    expect(bad.success).toBe(false);
    const fields = new Set(bad.error?.issues.map((i) => i.path[0]));
    expect(fields).toEqual(new Set(["email", "name", "password"]));
  });
});
