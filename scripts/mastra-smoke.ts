import { hasLlmKey, modelLabel } from "../src/mastra/model";
import { decideAgent } from "../src/mastra/agents/specialists";

async function main() {
  console.log({ hasLlmKey: hasLlmKey(), model: modelLabel() });
  const agent = decideAgent();
  const result = await agent.generate("Reply with exactly: GEMINI_OK");
  const text = String((result as { text?: string }).text ?? "");
  console.log(text.slice(0, 400));
  if (!/GEMINI_OK/i.test(text)) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
