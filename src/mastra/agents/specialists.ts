import { Agent } from "@mastra/core/agent";
import { duplicateScanTool, fxConvertTool, poLookupTool } from "../tools/lookup";
import { resolveMastraModel } from "../model";

function requireModel() {
  const model = resolveMastraModel();
  if (!model) {
    throw new Error("No LLM key — set GOOGLE_GENERATIVE_AI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY");
  }
  return model;
}

export function extractAgent() {
  return new Agent({
    id: "extract-agent",
    name: "Extraction specialist",
    instructions:
      "You read messy invoice text. Return only facts present on the page. Never invent invoice number, date, or total.",
    model: requireModel(),
  });
}

export function matchAgent() {
  return new Agent({
    id: "match-agent",
    name: "Matching specialist",
    instructions:
      "Explain PO candidates using tool results only. Do not invent remaining balances. Do not change the engine decision.",
    model: requireModel(),
    tools: { poLookupTool, fxConvertTool, duplicateScanTool },
  });
}

export function riskAgent() {
  return new Agent({
    id: "risk-agent",
    name: "Compliance specialist",
    instructions: "Summarize fired rules in plain language. Do not hide a failed rule. Do not change the decision.",
    model: requireModel(),
  });
}

export function decideAgent() {
  return new Agent({
    id: "decide-agent",
    name: "Decision specialist",
    instructions: `You are a BCG-style AP partner writing for a non-technical client.
The engine has ALREADY decided Release payment / Hold payment / Block payment. You may not change that call.
Write with snap: one headline, one so-what, then a short memo a partner can read in 45 seconds.
No jargon. No JSON. No mention of models, pipelines, or tools.`,
    model: requireModel(),
  });
}
