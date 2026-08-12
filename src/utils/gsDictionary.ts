export interface GsDictionary {
  abbreviations?: Record<string, string[]>;
  replacements?: Record<string, string[]>;
}

function normalizeDictionary(raw: any): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const dict: Record<string, string[]> = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (!key || typeof key !== 'string') return;
    if (Array.isArray(value)) {
      const options = value.map(item => String(item).trim()).filter(Boolean);
      if (options.length > 0) dict[key] = options;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) dict[key] = [trimmed];
    }
  });

  return Object.keys(dict).length > 0 ? dict : undefined;
}

export async function loadGsDictionary(): Promise<GsDictionary | null> {
  try {
    const res = await fetch('gs-dictionary.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;

    const abbreviations = normalizeDictionary(data.abbreviations);
    const replacements = normalizeDictionary(data.replacements);

    return {
      abbreviations,
      replacements,
    };
  } catch (err) {
    console.warn('Failed to load GS dictionary:', err);
    return null;
  }
}

