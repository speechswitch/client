import type { SpeechSpec } from "./spec-model.ts";

export function renderSpecMarkdown(spec: SpeechSpec): string {
  const lines = ["# Normalized speech API", "", spec.tts.request.documentation, "", "## TTS request", ""];
  for (const field of spec.tts.request.fields) {
    lines.push(`### \`${field.name}\``, "", field.documentation, "", `Type: \`${field.typeScriptType}\`${field.optional ? " (optional)" : ""}.`, "");
  }
  for (const provider of spec.tts.providers) {
    lines.push(`## ${provider.id}`, "");
    for (const model of provider.models) {
      lines.push(`### \`${model.id}\``, "", ...(model.documentation ? [model.documentation, ""] : []));
      const alternatives = model.request.kind === "union" ? model.request.anyOf : [model.request];
      alternatives.forEach((alternative, index) => {
        if (alternative.kind !== "object") return;
        if (alternatives.length > 1) lines.push(`Request variant ${index + 1}:`, "");
        for (const field of alternative.fields) lines.push(`- \`${field.name}\`: \`${field.typeScriptType}\``);
        if (alternatives.length > 1) lines.push("");
      });
      lines.push("");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}
