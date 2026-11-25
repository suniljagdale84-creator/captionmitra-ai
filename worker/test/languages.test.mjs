import test from "node:test";
import assert from "node:assert/strict";
import { getLanguageInstruction, normalizeOutputLanguage } from "../src/languages.mjs";

test("supports Hindi, Marathi, English and Hinglish", () => {
  for (const language of ["Hindi", "Marathi", "English", "Hinglish"]) {
    assert.equal(normalizeOutputLanguage(language), language);
    assert.ok(getLanguageInstruction(language).length > 10);
  }
});

test("Hinglish explicitly uses Roman script", () => {
  assert.match(getLanguageInstruction("Hinglish"), /Roman\/Latin letters/);
  assert.match(getLanguageInstruction("Hinglish"), /Do not use Devanagari/);
});

test("rejects unsupported output languages", () => {
  assert.throws(() => normalizeOutputLanguage("Auto Detect"), /Unsupported output language/);
});
