import speechSpec from "virtual:speech-spec"

import { providerSchemasFromSpeechSpec } from "./provider-schemas"

export function analyzeProviders() {
  return providerSchemasFromSpeechSpec(speechSpec)
}
