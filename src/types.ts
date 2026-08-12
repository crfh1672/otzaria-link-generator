/**
 * Types & Interfaces according to Otzaria Links Generator Plugin SRS
 */

/**
 * A single Top-K candidate returned by the search algorithm.
 * Stored on OtzariaLink so the UI can offer "next candidate" without re-running the search.
 */
export interface LinkCandidate {
  lineNum: number;      // 1-based physical line index in the target source
  score: number;        // Raw match score from searchLineInDoc
  confidence: number;   // Normalised 0-100 confidence (same scale as OtzariaLink.confidence)
}

export interface OtzariaLink {
  line_index_1: number;       // 1-based physical line index of commentary
  line_index_2: number;       // 1-based physical line index of target source
  heRef_2: string;            // Hebrew reference (e.g. "בראשית א, א")
  path_2: string;             // Target source filename in system (e.g. "בראשית.txt")
  connection_type: "commentary";
  
  // UI and internal routing state
  secondaryTarget?: 'rashi' | 'tosafot';
  secondary_line_index?: number;
  secondaryRef?: string;
  isInherited?: boolean;      // True if context was inherited (purple background)
  dhText?: string;            // Extracted Dibur Hamatchil
  confidence?: number;        // Confidence level score (0 - 100%)
  status?: 'approved' | 'pending'; // Approval state for link review

  // Pre-calculated visual match range in target source line
  matchRange?: DHHighlight;

  // Top-K alternative candidates (up to 3, sorted best-first).
  // candidates[0] mirrors line_index_2 (the selected candidate).
  // The user can cycle through candidates[1], candidates[2] without re-running the algorithm.
  candidates?: LinkCandidate[];
  /** Index into `candidates` that is currently displayed (0-based). Default 0. */
  candidateIndex?: number;
}

export interface PluginConfig {
  sourceCategory: 'tanakh' | 'shas';
  targetBookName: string;
  ignoreShamInShas: boolean;      // "האם המילה 'שם' משמשת כהפניה לדף בגמרא?"
  diburHamatchilDelimiter?: string; // "תו סיום דיבור המתחיל" (e.g. '.' or '.:')
  useAbbreviationExpansion?: boolean; // "תמיכה בפענוח ראשי תיבות"
  customAbbreviations?: Record<string, string[]>; // מילון ראשי תיבות מותאם אישית
  useFuzzyMatching?: boolean; // "השוואה גמישה קלה (Fuzzy Matching)"
  useWordWeighting?: boolean; // "שקילת מילים וסינון מילות יחס (Word Weighting)"
}

export interface DHHighlight {
  wordStart: number;
  wordCount: number;
  /**
   * Optional disjoint match clusters within the [wordStart, wordStart+wordCount) span.
   * When present, renderers should highlight each segment separately instead of the
   * single wordStart/wordCount span, which may bridge over unmatched words sitting
   * between clusters. Absent for backward compatibility with older sessions/consumers
   * that only read wordStart/wordCount (that pair still reflects the outer bounding span).
   */
  segments?: { wordStart: number; wordCount: number }[];
}

export interface SessionState {
  id: string;
  commentaryFileName: string;
  commentaryTitle: string;
  config: PluginConfig;
  links: OtzariaLink[];
  commentaryLines: string[];      // Physical raw text lines (\n preserved)
  sourceLines: string[];          // Primary source physical lines
  rashiLines?: string[];          // Secondary Rashi lines (if Shas)
  tosafotLines?: string[];        // Secondary Tosafot lines (if Shas)
  dhHighlights?: Record<number, DHHighlight>; // line_index_1 -> word highlights
  lastModifiedTimestamp: number;
}

export interface BookNode {
  title: string;
  path: string;
  categories?: BookNode[];
  books?: {
    bookId: string;
    title: string;
    type?: string;
    author?: string;
    topics?: string;
  }[];
}

export const TANAKH_BOOKS = [
  "בראשית", "שמות", "ויקרא", "במדבר", "דברים",
  "יהושע", "שופטים", "שמואל א", "שמואל ב", "מלכים א", "מלכים ב",
  "ישעיהו", "ירמיהו", "יחזקאל",
  "הושע", "יואל", "עמוס", "עובדיה", "יונה", "מיכה", "נחום", "חבקוק", "צפניה", "חגי", "זכריה", "מלאכי"
];

export const SHAS_TRACTATES = [
  "ברכות", "שבת", "עירובין", "פסחים", "ראש השנה", "יומא", "סוכה", "ביצה", "תענית", "מגילה", "מועד קטן", "חגיגה",
  "יבמות", "כתובות", "נדרים", "נזיר", "סוטה", "גיטין", "קידושין",
  "בבא קמא", "בבא מציעא", "בבא בתרא", "סנהדרין", "מכות", "שבועות", "עבודה זרה", "הוריות",
  "זבחים", "מנחות", "חולין", "בכורות", "ערכין", "תמורה", "כריתות", "מעילה", "תמיד", "נדה"
];
