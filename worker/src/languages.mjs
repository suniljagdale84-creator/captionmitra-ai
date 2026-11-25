export const OUTPUT_LANGUAGES = Object.freeze({
  Hindi: { instruction: "Write natural Hindi using Devanagari script." },
  Marathi: { instruction: "Write natural Marathi using Devanagari script and correct Marathi grammar." },
  English: { instruction: "Write natural, clear English." },
  Hinglish: { instruction: "Write conversational Hindi in Roman/Latin letters (Hinglish). Do not use Devanagari. Keep common English words naturally; do not convert it into formal English." }
});

export function normalizeOutputLanguage(value) {
  if (typeof value !== "string") throw new Error("A supported output language is required");
  const match = Object.keys(OUTPUT_LANGUAGES).find((name) => name.toLowerCase() === value.trim().toLowerCase());
  if (!match) throw new Error("Unsupported output language");
  return match;
}

export function getLanguageInstruction(value) {
  return OUTPUT_LANGUAGES[normalizeOutputLanguage(value)].instruction;
}
