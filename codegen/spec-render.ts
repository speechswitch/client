import type { SpeechSpec } from "./spec-model.ts";

export function renderSpecMarkdown(spec: SpeechSpec): string {
  const lines = ["# Normalized speech API", "", spec.tts.request.documentation, "", "## TTS request", ""];
  for (const field of spec.tts.request.fields) {
    lines.push(`### \`${field.name}\``, "", field.documentation, "", `Type: \`${field.typeScriptType}\`${field.optional ? " (optional)" : ""}.`, "");
  }
  for (const provider of spec.tts.providers) {
    lines.push(`## ${provider.id}`, "", ...(provider.documentation ? [provider.documentation, ""] : []));
    const alternatives = provider.request.kind === "union" ? provider.request.anyOf : [provider.request];
    alternatives.forEach((alternative, index) => {
      if (alternative.kind !== "object") return;
      if (alternatives.length > 1) lines.push(`Request variant ${index + 1}:`, "");
      for (const field of alternative.fields) lines.push(`- \`${field.name}\`: \`${field.typeScriptType}\`${field.default === undefined ? "" : ` (default: \`${JSON.stringify(field.default)}\`)`}`);
      if (alternatives.length > 1) lines.push("");
    });
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}
