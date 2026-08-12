import React, { useState } from 'react';
import { Save, FolderOpen, Download, ArrowLeftRight, RotateCcw, ListTree, Filter, Menu } from 'lucide-react';
import JSZip from 'jszip';
import { SessionState } from '../types';
import { formatLineWithDH, parseDocumentSegments, normalizeText, areHeadersMatching, isHeaderLine } from '../utils/parserAlgorithm';
import { getWordSimilarity } from '../utils/fuzzyUtils';
import { calculateDocumentIdfWeights, getCombinedWordWeight } from '../utils/wordWeights';
import { notifySuccess, notifyError } from '../utils/otzariaBridge';

interface TopToolbarProps {
  sortMode?: 'book_order' | 'score_asc' | 'score_desc';
  onSortModeChange?: (mode: 'book_order' | 'score_asc' | 'score_desc') => void;
  session: SessionState | null;
  mode: 'setup' | 'edit';
  onSaveSession: () => void;
  onOpenProjects: () => void;
  
  onReturnToSetup: () => void;
  isNavDrawerOpen?: boolean;
  onToggleNavDrawer?: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  session,
  mode,
  onSaveSession,
  onOpenProjects,
  onReturnToSetup,
  isNavDrawerOpen,
  onToggleNavDrawer,
  sortMode,
  onSortModeChange,
}) => {
  const commentaryName = session?.commentaryTitle || 'ספר פירוש';
  const sourceName = session?.config?.targetBookName || 'ספר מקור';
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const handleExportZip = async () => {
    if (!session) {
      notifyError('אין פרויקט פעיל לייצוא');
      return;
    }

    try {
      const zip = new JSZip();

      // 1. Generate _links.json
      const exportedLinks: any[] = [];
      session.links.forEach(link => {
        exportedLinks.push({
          line_index_1: link.line_index_1,
          line_index_2: link.line_index_2,
          heRef_2: link.heRef_2,
          path_2: link.path_2,
          connection_type: link.connection_type
        });
      });

      const linksJsonContent = JSON.stringify(exportedLinks, null, 2);
      const cleanFileName = session.commentaryTitle.replace(/[/\\?%*:|"<>]/g, '_');
      zip.file(`${cleanFileName}_links.json`, linksJsonContent);

      // 2. Generate _links.csv without dhText/confidence/status
      const csvHeaders = ['line_index_1', 'line_index_2', 'heRef_2', 'path_2', 'connection_type'];
      const escapeCsv = (val: any) => {
        if (val === undefined || val === null) return '""';
        const str = String(val);
        if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return `"${str}"`;
      };

      const csvRows = session.links.map(link => [
        escapeCsv(link.line_index_1),
        escapeCsv(link.line_index_2),
        escapeCsv(link.heRef_2),
        escapeCsv(link.path_2),
        escapeCsv(link.connection_type || 'commentary')
      ].join(','));

      const csvContent = '\uFEFF' + [csvHeaders.join(','), ...csvRows].join('\r\n');
      zip.file(`${cleanFileName}_links.csv`, csvContent);

      // 3. Generate analysis CSV with DH, source word comparisons and score details
      const analysisHeaders = [
        'line_index_1',
        'commentary_line',
        'dh_text',
        'commentary_words',
        'line_index_2',
        'source_line',
        'source_words',
        'confidence',
        'status',
        'word_score_breakdown',
        'word_score_changes',
        'candidate_scores',
        'analysis_notes'
      ];

      const normalizeForCsv = (val: any) => escapeCsv(val === undefined || val === null ? '' : val);
      const sourceIdfWeights = calculateDocumentIdfWeights(session.sourceLines, session.commentaryLines);
      const analysisRows = session.links.map(link => {
        const commentaryLine = session.commentaryLines[link.line_index_1 - 1] || '';
        const sourceLine = session.sourceLines[link.line_index_2 - 1] || '';
        const dhText = link.dhText || '';
        const commentaryWords = normalizeText(commentaryLine).split(/\s+/).filter(Boolean);
        const sourceWords = normalizeText(sourceLine).split(/\s+/).filter(Boolean);

        const wordContributions = commentaryWords.map(word => {
          const wordWeight = getCombinedWordWeight(word, true, sourceIdfWeights);
          const bestMatch = sourceWords
            .map(sw => ({ sw, sim: getWordSimilarity(word, sw, true) }))
            .sort((a, b) => b.sim - a.sim)[0];

          const sim = bestMatch?.sim ?? 0;
          const contrib = parseFloat((wordWeight * sim).toFixed(2));
          const penalty = parseFloat((wordWeight * (1 - sim)).toFixed(2));
          const matchLabel = bestMatch?.sw ? `${bestMatch.sw}` : 'none';
          const label = `${word}->${matchLabel}:${sim.toFixed(2)}*${wordWeight.toFixed(2)}=${contrib.toFixed(2)}`;
          const type = sim >= 0.75 ? 'ADD' : 'SUB';
          return { word, label, type, contrib, penalty };
        });

        const addedWords = wordContributions
          .filter(item => item.type === 'ADD')
          .map(item => `${item.word}+${item.contrib.toFixed(2)}`)
          .join('; ');

        const subtractedWords = wordContributions
          .filter(item => item.type === 'SUB')
          .map(item => `${item.word}-${item.penalty.toFixed(2)}`)
          .join('; ');

        const wordScoreBreakdown = wordContributions.map(item => item.label).join(' | ');
        const candidateScores = link.candidates?.map(c => `${c.lineNum}:${c.score.toFixed(2)}`).join('; ') || '';
        const analysisNotes = `dh_words=${commentaryWords.length}; source_words=${sourceWords.length}; match_confidence=${link.confidence ?? 0}; candidates=${candidateScores || 'none'}`;

        return [
          normalizeForCsv(link.line_index_1),
          normalizeForCsv(commentaryLine),
          normalizeForCsv(dhText),
          normalizeForCsv(commentaryWords.join(' ')),
          normalizeForCsv(link.line_index_2),
          normalizeForCsv(sourceLine),
          normalizeForCsv(sourceWords.join(' ')),
          normalizeForCsv(link.confidence ?? ''),
          normalizeForCsv(link.status ?? ''),
          normalizeForCsv(wordScoreBreakdown),
          normalizeForCsv(`added:${addedWords || 'none'}; subtracted:${subtractedWords || 'none'}`),
          normalizeForCsv(candidateScores),
          normalizeForCsv(analysisNotes)
        ].join(',');
      });

      const analysisContent = '\uFEFF' + [analysisHeaders.join(','), ...analysisRows].join('\r\n');
      zip.file(`${cleanFileName}_analysis.csv`, analysisContent);

      // 3. Generate updated commentary .txt file with <b>...</b> tags
      const updatedLines = session.commentaryLines.map((line, idx) => {
        const lineIdx1 = idx + 1; // 1-based
        const highlight = session.dhHighlights?.[lineIdx1];
        if (highlight && highlight.wordCount > 0) {
          return formatLineWithDH(line, highlight, undefined, undefined, true);
        }
        return line;
      });

      // Join strictly with physical newlines (\n) - NO <br> tags!
      const txtContent = updatedLines.join('\n');
      zip.file(`${cleanFileName}.txt`, txtContent);

      // 4. Generate unlinked lines folder
      const linkedLineIndices = new Set(session.links.map(l => l.line_index_1));
      
      const commDoc = parseDocumentSegments(session.commentaryLines.join('\n'));
      const srcDoc = parseDocumentSegments(session.sourceLines.join('\n'));
      const rashiDoc = session.rashiLines ? parseDocumentSegments(session.rashiLines.join('\n')) : null;
      const tosafotDoc = session.tosafotLines ? parseDocumentSegments(session.tosafotLines.join('\n')) : null;
      
      const unlinkedFolder = zip.folder("שורות_ללא_קישור");
      
      if (unlinkedFolder) {
        commDoc.segments.forEach(commSeg => {
          const srcSeg = srcDoc.segments.find(s => areHeadersMatching(commSeg.headerTitle, s.headerTitle));
          const rashiSeg = rashiDoc ? rashiDoc.segments.find(s => areHeadersMatching(commSeg.headerTitle, s.headerTitle)) : null;
          const tosafotSeg = tosafotDoc ? tosafotDoc.segments.find(s => areHeadersMatching(commSeg.headerTitle, s.headerTitle)) : null;
          
          for (let i = commSeg.startLine; i <= commSeg.endLine; i++) {
            if (i > session.commentaryLines.length) break;
            const line = session.commentaryLines[i - 1];
            if (!line || !line.trim() || isHeaderLine(line)) continue;
            
            if (!linkedLineIndices.has(i)) {
              let content = `שורה מפרש ללא קישור (שורה ${i}):\n${line}\n\n`;
              content += `כותרת: ${commSeg.headerTitle}\n\n`;
              
              if (srcSeg) {
                content += `--- מקור ---\n`;
                content += session.sourceLines.slice(srcSeg.startLine - 1, srcSeg.endLine).join('\n') + '\n\n';
              }
              
              if (rashiSeg && session.rashiLines) {
                content += `--- רש"י ---\n`;
                content += session.rashiLines.slice(rashiSeg.startLine - 1, rashiSeg.endLine).join('\n') + '\n\n';
              }
              
              if (tosafotSeg && session.tosafotLines) {
                content += `--- תוספות ---\n`;
                content += session.tosafotLines.slice(tosafotSeg.startLine - 1, tosafotSeg.endLine).join('\n') + '\n\n';
              }
              
              const safeHeaderTitle = commSeg.headerTitle.replace(/[/\\?%*:|"<>]/g, '_').substring(0, 30).trim();
              unlinkedFolder.file(`${safeHeaderTitle}_שורה_${i}.txt`, content);
            }
          }
        });
      }

      // Generate ZIP blob and download
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanFileName}_package.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      notifySuccess('קובץ ZIP (כולל TXT, JSON ו-CSV) ייוצא בהצלחה!');
    } catch (e) {
      console.error(e);
      notifyError('אירעה שגיאה ביצירת קובץ ה-ZIP');
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-[var(--color-surface-container-high)] text-[var(--color-on-surface)] shadow-xs border-b border-[var(--color-outline)]" dir="rtl">
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-3">
        {/* Rightmost: Hamburger menu */}
        <button
          onClick={onToggleNavDrawer}
          className={`inline-flex items-center justify-center p-2 rounded-[var(--radius-sm)] transition-colors shrink-0 ${
            mode === 'setup'
              ? 'opacity-40 pointer-events-none text-[var(--color-on-surface-variant)]'
              : isNavDrawerOpen
                ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)]'
                : 'text-[var(--color-on-surface)] hover:bg-[var(--color-secondary-subtle)]'
          }`}
          title="תפריט ניווט"
          aria-label="תפריט המבורגר"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Books Tag */}
        <div className="flex items-center gap-2 px-1 py-1.5 shrink-0">
          <span className="text-xs font-bold text-[var(--color-primary)] max-w-[180px] truncate" title={commentaryName}>
            {commentaryName}
          </span>
          <ArrowLeftRight className="w-3.5 h-3.5 text-[var(--color-on-surface-variant)] shrink-0 mx-1" />
          <span className="text-xs font-bold text-[var(--color-on-surface)] max-w-[180px] truncate" title={sourceName}>
            {sourceName}
          </span>
          {session && (
            <span className="text-[11px] bg-[var(--color-primary-subtle)] text-[var(--color-primary)] font-bold px-2 py-0.5 rounded-[var(--radius-pill)] border border-[var(--color-outline-variant)] mr-2">
              {session.links.length} קישורים
            </span>
          )}
        </div>
        
        {/* Actions Group (Leftmost) */}
        <div className="flex items-center justify-end flex-1 gap-1">
          <button
            onClick={handleExportZip}
            disabled={!session}
            className="inline-flex items-center justify-center p-2 rounded-[var(--radius-sm)] text-[var(--color-on-surface)] hover:bg-[var(--color-secondary-subtle)] disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            title="ייצא קובץ ZIP"
            aria-label="הורדה"
          >
            <Download className="w-5 h-5" />
          </button>
          
          <button
            onClick={onOpenProjects}
            className="inline-flex items-center justify-center p-2 rounded-[var(--radius-sm)] text-[var(--color-on-surface)] hover:bg-[var(--color-secondary-subtle)] transition-colors"
            title="פתח פרויקט שמור מהמטמון"
            aria-label="פתיחת פרויקטים"
          >
            <FolderOpen className="w-5 h-5" />
          </button>

          <button
            onClick={onSaveSession}
            disabled={!session}
            className="inline-flex items-center justify-center p-2 rounded-[var(--radius-sm)] text-[var(--color-on-surface)] hover:bg-[var(--color-secondary-subtle)] disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            title="שמור מצב נוכחי"
            aria-label="שמירה"
          >
            <Save className="w-5 h-5" />
          </button>

          <div className="w-px h-5 bg-[var(--color-outline)] mx-1" />

          {mode === 'edit' && onSortModeChange && (
            <div className="relative inline-block">
              <button
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className="inline-flex items-center justify-center p-2 rounded-[var(--radius-sm)] text-[var(--color-on-surface)] hover:bg-[var(--color-secondary-subtle)] transition-colors"
                title="מיון תוצאות"
                aria-label="סינון ומיון"
              >
                <Filter className="w-5 h-5" />
              </button>
              {isFilterOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsFilterOpen(false)} />
                  <div className="absolute top-[calc(100%+6px)] left-0 w-48 bg-[var(--color-surface-container-highest)] rounded-[var(--radius-md)] shadow-lg border border-[var(--color-outline)] p-2 z-50 flex flex-col gap-1">
                    <button
                      className={`text-right px-3 py-2 text-xs font-semibold rounded-[var(--radius-sm)] ${sortMode === 'book_order' ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)]' : 'text-[var(--color-on-surface)] hover:bg-[var(--color-secondary-subtle)]'}`}
                      onClick={() => { onSortModeChange('book_order'); setIsFilterOpen(false); }}
                    >
                      מיון לפי סדר הספר
                    </button>
                    <button
                      className={`text-right px-3 py-2 text-xs font-semibold rounded-[var(--radius-sm)] ${sortMode === 'score_asc' ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)]' : 'text-[var(--color-on-surface)] hover:bg-[var(--color-secondary-subtle)]'}`}
                      onClick={() => { onSortModeChange('score_asc'); setIsFilterOpen(false); }}
                    >
                      מיון לפי ניקוד (סדר עולה)
                    </button>
                    <button
                      className={`text-right px-3 py-2 text-xs font-semibold rounded-[var(--radius-sm)] ${sortMode === 'score_desc' ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)]' : 'text-[var(--color-on-surface)] hover:bg-[var(--color-secondary-subtle)]'}`}
                      onClick={() => { onSortModeChange('score_desc'); setIsFilterOpen(false); }}
                    >
                      מיון לפי ניקוד (סדר יורד)
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {mode === 'edit' && (
            <button
              onClick={onReturnToSetup}
              className="inline-flex items-center justify-center p-2 rounded-[var(--radius-sm)] text-[var(--color-on-surface)] hover:bg-[var(--color-secondary-subtle)] transition-colors"
              title="חזור למסך בחירת ספרים"
              aria-label="רענון"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

