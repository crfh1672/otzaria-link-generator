import io

BS = chr(92)  # backslash

src = io.open('src/data/abbreviations.ts', encoding='utf-8').read()
out = src

def rep(a, b, n=1):
    global out
    c = out.count(a)
    assert c == n, (c, a[:70])
    out = out.replace(a, b)

rep("import { DEFAULT_REPLACEMENTS } from './replacements';",
    "import { DEFAULT_REPLACEMENTS } from '../src/data/replacements';")

# --- stripNikud: drop the memo -------------------------------------------------
rep("  const hit = stripNikudCache.get(text);\n  if (hit !== undefined) return hit;\n  const out = text.replace(",
    "  void STRIP_NIKUD_CACHE_LIMIT; void stripNikudCache;\n  return text.replace(")
rep("  if (stripNikudCache.size >= STRIP_NIKUD_CACHE_LIMIT) stripNikudCache.clear();\n  stripNikudCache.set(text, out);\n  return out;\n}",
    "}")

# --- cleanAbbrKey: drop the memo ----------------------------------------------
rep("  const hit = cleanKeyCache.get(key);\n  if (hit !== undefined) return hit;\n  const out = key",
    "  void CLEAN_KEY_CACHE_LIMIT; void cleanKeyCache;\n  return key")
rep("    .trim();\n  if (cleanKeyCache.size < CLEAN_KEY_CACHE_LIMIT) cleanKeyCache.set(key, out);\n  return out;\n}",
    "    .trim();\n}")

# --- getInitialLettersFromAbbr: drop the memo ---------------------------------
rep("  const hit = initialsCache.get(abbr);\n  if (hit !== undefined) return hit;\n  const out = cleanAbbrKey(abbr)",
    "  void INITIALS_CACHE_LIMIT; void initialsCache;\n  return cleanAbbrKey(abbr)")
rep("    .filter(Boolean);\n  if (initialsCache.size < INITIALS_CACHE_LIMIT) initialsCache.set(abbr, out);\n  return out;\n}",
    "    .filter(Boolean);\n}")

# --- getTargetIndex: drop the memo -------------------------------------------
rep("  const hit = targetIndexCache.get(targetText);\n  if (hit !== undefined) return hit;\n",
    "  void TARGET_INDEX_LIMIT; void targetIndexCache;\n")
rep("  if (targetIndexCache.size >= TARGET_INDEX_LIMIT) targetIndexCache.clear();\n  targetIndexCache.set(targetText, entry);\n  return entry;",
    "  return entry;")

# --- findPhraseByInitials: force the original general scan --------------------
rep("  let simple = true;\n  for (let j = 0; j < len; j++) {\n    if (initials[j].length !== 1) { simple = false; break; }\n  }\n",
    "  let simple = false;\n")

# --- maxTokens window: ignore -------------------------------------------------
rep("  const tokenLimit = maxTokens === undefined\n    ? nonWsIndices.length\n    : Math.min(maxTokens, nonWsIndices.length);",
    "  void maxTokens;\n  const tokenLimit = nonWsIndices.length;")

# --- initials fallback: restore original guard shape --------------------------
rep("""      if (!options) {
        const abbreviationLetters = getInitialLettersFromAbbr(rawJoined);
        const initialsMatch = abbreviationLetters.length > 1
          ? findPhraseByInitials(targetNorm, abbreviationLetters)
          : null;
        if (initialsMatch) {""",
    """      const abbreviationLetters = getInitialLettersFromAbbr(rawJoined);
      if (!options && abbreviationLetters.length > 1) {
        const initialsMatch = findPhraseByInitials(targetNorm, abbreviationLetters);
        if (initialsMatch) {""")

io.open('qa/eq2-abbrev.ref.ts', 'w', encoding='utf-8', newline='\n').write(out)
print('wrote qa/eq2-abbrev.ref.ts', len(out))
