import type { DecisionProvider } from "../core/types.js";
import { JevProvider } from "./jev.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { SemanticNliProvider } from "./semantic-nli.js";
import { SemanticLocalProvider } from "./semantic-local.js";

export function createProvider(id = process.env.AGENT_DECISION_PROVIDER ?? "semantic"): DecisionProvider {
  switch (id.toLowerCase()) {
    case "semantic":
    case "local":
    case "semantic-local":
      return new SemanticLocalProvider();
    case "semantic-nli":
    case "local-nli":
      return new SemanticNliProvider();
    case "openai":
    case "openai-compatible":
      return new OpenAICompatibleProvider();
    case "jev":
      return new JevProvider();
    default:
      throw new Error(`Unknown provider '${id}'. Use semantic, semantic-nli, openai-compatible, or jev.`);
  }
}

export { JevProvider, OpenAICompatibleProvider, SemanticLocalProvider, SemanticNliProvider };
