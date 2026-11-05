import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "invoice-workbench",
  isDev: process.env.NODE_ENV !== "production",
});
