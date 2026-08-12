import React, { useState, useEffect, useMemo } from 'react';
import { BookNode, PluginConfig, TANAKH_BOOKS, SHAS_TRACTATES } from '../types';
import { MOCK_LIBRARY_TREE } from '../data/otzariaLibraryMock';
import { fetchLibraryTree, fetchBookContent, fetchBookLinks, notifyError, notifySuccess, saveToCache, getFromCache, removeFromCache } from '../utils/otzariaBridge';
import { loadGsDictionary } from '../utils/gsDictionary';
import { AbbreviationsModal } from './AbbreviationsModal';
import { ToggleSwitch } from './ToggleSwitch';
import {
  Search,
  Upload,
  BookOpen,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  Play,
  FileText,
  Settings2,
  CheckCircle2,
  Quote,
  ArrowLeftRight,
  Scale,
  Check
} from 'lucide-react';

interface SetupModeProps {
  onRunAlgorithm: (
    commentaryText: string,
    commentaryTitle: string,
    config: PluginConfig,
    sourceText: string,
    rashiText?: string,
    tosafotText?: string,
    rashiLinks?: any[],
    tosafotLinks?: any[]
  ) => void;
}

export const SetupMode: React.FC<SetupModeProps> = ({ onRunAlgorithm }) => {
  // Tree & Selected Book State
  const [tree, setTree] = useState<BookNode | null>(null);
  const [loadingTree, setLoadingTree] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Loaded Commentary State
  const [selectedBookTitle, setSelectedBookTitle] = useState<string | null>(null);
  const [commentaryContent, setCommentaryContent] = useState<string>('');
  const [loadingBookContent, setLoadingContent] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({
    '/תנך': true,
    '/שס': true
  });

  // Config State
  const [category, setCategory] = useState<'tanakh' | 'shas'>('tanakh');
  const [targetBook, setTargetBook] = useState<string>(TANAKH_BOOKS[0]);
  const [ignoreShamInShas, setIgnoreShamInShas] = useState<boolean>(true);
  const [delimiter, setDelimiter] = useState<string>('');

  // Rashei Teivot (Abbreviations) & Fuzzy Matching State
  const [useAbbreviationExpansion, setUseAbbreviationExpansion] = useState<boolean>(true);
  const [customAbbreviations, setCustomAbbreviations] = useState<Record<string, string[]> | undefined>(undefined);
  const [gsAbbreviations, setGsAbbreviations] = useState<Record<string, string[]> | undefined>(undefined);
  const [gsReplacements, setGsReplacements] = useState<Record<string, string[]> | undefined>(undefined);
  const [gsSourceLoaded, setGsSourceLoaded] = useState<boolean>(false);
  const [showAbbrModal, setShowAbbrModal] = useState<boolean>(false);
  const [useFuzzyMatching, setUseFuzzyMatching] = useState<boolean>(true);
  const [useWordWeighting, setUseWordWeighting] = useState<boolean>(true);

  const [isProcessing, setIsProcessing] = useState(false);

  // Update default target book when category changes
  useEffect(() => {
    if (category === 'tanakh') {
      if (!TANAKH_BOOKS.includes(targetBook)) {
        setTargetBook(TANAKH_BOOKS[0]);
      }
    } else {
      if (!SHAS_TRACTATES.includes(targetBook)) {
        setTargetBook(SHAS_TRACTATES[0]);
      }
    }
  }, [category]);

  useEffect(() => {
    const loadGs = async () => {
      try {
        const cachedCustomAbbreviations = await getFromCache<Record<string, string[]>>('customAbbreviations');
        const cachedAbbreviations = await getFromCache<Record<string, string[]>>('gsAbbreviations');
        const cachedReplacements = await getFromCache<Record<string, string[]>>('gsReplacements');
        const gsDict = await loadGsDictionary();

        if (cachedCustomAbbreviations) {
          setCustomAbbreviations(cachedCustomAbbreviations);
        }

        if (cachedAbbreviations) {
          setGsAbbreviations(cachedAbbreviations);
        } else if (gsDict?.abbreviations) {
          setGsAbbreviations(gsDict.abbreviations);
        }

        if (cachedReplacements) {
          setGsReplacements(cachedReplacements);
        } else if (gsDict?.replacements) {
          setGsReplacements(gsDict.replacements);
        }
      } catch (err) {
        console.warn('Failed to load GS dictionary:', err);
      } finally {
        setGsSourceLoaded(true);
      }
    };

    loadGs();
  }, []);

  const findBookInTreeRecursive = (node: BookNode, targetName: string, keyword: string, source: 'rashi' | 'tosafot'): string | null => {
    if (node.books) {
      for (const b of node.books) {
        const t = (b.title || b.bookId || '').toLowerCase();
        if (t.includes(targetName.toLowerCase()) && (t.includes(keyword) || t.includes(keyword.replace(/"/g, '')))) {
          if (source === 'tosafot') {
            if (
              t.includes('יהודה') ||
              t.includes('החסיד') ||
              t.includes('רא"ש') ||
              t.includes('הרא"ש') ||
              t.includes('פרץ') ||
              t.includes('ריצב') ||
              t.includes('רש"ש') ||
              t.includes('מהר"ם')
            ) {
              continue;
            }
          }
          return b.bookId;
        }
      }
    }
    if (node.categories) {
      for (const cat of node.categories) {
        const found = findBookInTreeRecursive(cat, targetName, keyword, source);
        if (found) return found;
      }
    }
    return null;
  };

  const getSecondaryBookVariants = (targetBook: string, source: 'rashi' | 'tosafot') => {
    const variants: string[] = [];
    const base = targetBook.replace(/^מסכת\s+/i, '').replace(/^ספר\s+/i, '').trim();

    if (source === 'rashi') {
      variants.push(
        `רש"י על ${targetBook}`,
        `רש"י על ${base}`,
        `רש"י ${targetBook}`,
        `רש"י ${base}`,
        `רשי על ${targetBook}`,
        `רשי על ${base}`,
        `רשי ${targetBook}`,
        `רשי ${base}`,
        `רש"י על מסכת ${base}`,
        `רש"י על ספר ${base}`,
        `רש"י על מסכת ${targetBook}`,
        `רש"י`
      );
    } else {
      variants.push(
        `תוספות על ${targetBook}`,
        `תוספות על ${base}`,
        `תוס' על ${targetBook}`,
        `תוס' על ${base}`,
        `תוס על ${targetBook}`,
        `תוס על ${base}`,
        `תוסות על ${targetBook}`,
        `תוסות על ${base}`,
        `תוספות על מסכת ${base}`,
        `תוס' על מסכת ${base}`,
        `תוספות`,
        `תוס'`
      );
    }

    if (tree) {
      const foundId = findBookInTreeRecursive(tree, base, source === 'rashi' ? 'רש' : 'תוס', source);
      if (foundId && !variants.includes(foundId)) {
        variants.push(foundId);
      }
    }

    return Array.from(new Set(variants));
  };

  const tryFetchSecondarySource = async (
    variants: string[]
  ): Promise<{ text?: string; links: any[] }> => {
    for (const candidate of variants) {
      const raw = await fetchBookContent(candidate);
      if (raw && !raw.includes('לא נמצא תוכן עבור ספר זה')) {
        const candidateLinks = await fetchBookLinks(candidate);
        return { text: raw, links: candidateLinks || [] };
      }
    }
    return { links: [] };
  };

  // Load Library Tree on mount and retry when Otzaria becomes available or plugin.boot fires.
  useEffect(() => {
    let isMounted = true;
    let cleanupBootListener: (() => void) | null = null;
    let retryCount = 0;
    let currentTreeIsMock = true;

    const loadTree = async () => {
      const treeData = await fetchLibraryTree();
      if (!isMounted) return;
      setTree(treeData);
      setLoadingTree(false);
      currentTreeIsMock = treeData === MOCK_LIBRARY_TREE;
    };

    const attachBootListener = () => {
      if (typeof window !== 'undefined' && window.Otzaria?.on) {
        const onBoot = async () => {
          if (!isMounted) return;
          await loadTree();
        };
        window.Otzaria.on('plugin.boot', onBoot);
        cleanupBootListener = () => window.Otzaria?.off?.('plugin.boot', onBoot);
        return true;
      }
      return false;
    };

    attachBootListener();
    loadTree();

    const retryId = window.setInterval(() => {
      retryCount += 1;
      if (!isMounted || retryCount > 10) {
        window.clearInterval(retryId);
        return;
      }

      if (attachBootListener()) {
        window.clearInterval(retryId);
        return;
      }

      if (currentTreeIsMock) {
        loadTree();
      }
    }, 1000);

    return () => {
      isMounted = false;
      window.clearInterval(retryId);
      cleanupBootListener?.();
    };
  }, []);

  const handleSelectBookFromTree = async (bookId: string, title: string) => {
    setSelectedBookTitle(title);
    setLoadingContent(true);
    try {
      const content = await fetchBookContent(bookId);
      setCommentaryContent(content);
    } catch (e) {
      console.error(e);
      notifyError('שגיאה בטעינת תוכן הספר');
    } finally {
      setLoadingContent(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        const title = file.name.replace(/\.[^/.]+$/, '');
        setSelectedBookTitle(title);
        setCommentaryContent(text);
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleSaveDict = async (newDict: Record<string, string[]> | undefined) => {
    setCustomAbbreviations(newDict);
    setGsAbbreviations(newDict);

    if (newDict === undefined) {
      await removeFromCache('customAbbreviations');
      await removeFromCache('gsAbbreviations');
    } else {
      await saveToCache('customAbbreviations', newDict);
      await saveToCache('gsAbbreviations', newDict);
    }
  };

  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => ({ ...prev, [path]: !prev[path] }));
  };

  
  const getFlatBooksMatchingSearch = (node: BookNode, query: string): Array<{bookId: string, title: string, path: string}> => {
    let results: Array<{bookId: string, title: string, path: string}> = [];
    const q = query.toLowerCase().trim();
    if (node.books) {
      for (const b of node.books) {
        if (b.title.toLowerCase().includes(q) || b.bookId.toLowerCase().includes(q)) {
          results.push({ bookId: b.bookId, title: b.title, path: node.title === 'ספריית אוצריא' ? '' : node.title });
        }
      }
    }
    if (node.categories) {
      for (const child of node.categories) {
        results = results.concat(getFlatBooksMatchingSearch(child, query));
      }
    }
    return results;
  };

  const doesNodeMatchSearch = (node: BookNode): boolean => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;

    const booksMatch = node.books?.some(b =>
      b.title.toLowerCase().includes(q) || b.bookId.toLowerCase().includes(q)
    );
    if (booksMatch) return true;

    return node.categories?.some(child => doesNodeMatchSearch(child)) ?? false;
  };

  const handleRun = async () => {
    if (!selectedBookTitle || !commentaryContent.trim()) {
      notifyError('אנא בחר ספר פירוש או טען קובץ טקסט');
      return;
    }

    setIsProcessing(true);
    try {
      // Fetch primary target source book
      const sourceText = await fetchBookContent(targetBook);

      let rashiText: string | undefined = undefined;
      let tosafotText: string | undefined = undefined;
      let rashiLinks: any[] = [];
      let tosafotLinks: any[] = [];

      // Fetch secondary source files (Rashi and Tosafot for target book if available)
      try {
        const rashiVariants = getSecondaryBookVariants(targetBook, 'rashi');
        const rashiResult = await tryFetchSecondarySource(rashiVariants);
        if (rashiResult.text) {
          rashiText = rashiResult.text;
          rashiLinks = rashiResult.links;
        }
      } catch {
        rashiText = undefined;
      }

      try {
        const tosafotVariants = getSecondaryBookVariants(targetBook, 'tosafot');
        const tosafotResult = await tryFetchSecondarySource(tosafotVariants);
        if (tosafotResult.text) {
          tosafotText = tosafotResult.text;
          tosafotLinks = tosafotResult.links;
        }
      } catch {
        tosafotText = undefined;
      }

      const config: PluginConfig = {
        sourceCategory: category,
        targetBookName: targetBook,
        ignoreShamInShas,
        diburHamatchilDelimiter: delimiter,
        useAbbreviationExpansion,
        customAbbreviations: customAbbreviations ?? gsAbbreviations,
        gsAbbreviations,
        gsReplacements,
        useFuzzyMatching,
        useWordWeighting
      };

      onRunAlgorithm(
        commentaryContent,
        selectedBookTitle,
        config,
        sourceText,
        rashiText,
        tosafotText,
        rashiLinks,
        tosafotLinks
      );
    } catch (err) {
      console.error(err);
      notifyError('שגיאה בריצת אלגוריתם המיפוי');
    } finally {
      setIsProcessing(false);
    }
  };

  // Render recursive category tree
  const renderTreeNode = (node: BookNode) => {
    const isExpanded = expandedPaths[node.path];
    const hasCategories = node.categories && node.categories.length > 0;

    // Filter books based on search query without hooks inside recursive calls
    const q = searchQuery.toLowerCase().trim();
    const filteredBooks = (!node.books)
      ? []
      : (!q)
      ? node.books
      : node.books.filter(b => b.title.toLowerCase().includes(q) || b.bookId.toLowerCase().includes(q));

    if (!hasCategories && filteredBooks.length === 0 && q) {
      return null;
    }
    if (q && !doesNodeMatchSearch(node)) {
      return null;
    }

    if (node.path === '/') {
      return (
        <div key={node.path} className="bg-[var(--color-surface)] border border-[var(--color-outline-variant)] rounded-[var(--radius-md)] flex flex-col divide-y divide-[var(--color-outline-variant)] overflow-hidden shadow-xs">
          {node.categories?.map(child => renderTreeNode(child))}
          {filteredBooks.map(book => (
            <button
              key={book.bookId}
              onClick={() => handleSelectBookFromTree(book.bookId, book.title)}
              className={`flex items-center gap-2.5 w-full text-right py-3 px-3.5 text-sm font-medium transition-all ${
                selectedBookTitle === book.title
                  ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)] font-bold'
                  : 'hover:bg-[var(--color-secondary-subtle)] text-[var(--color-on-surface)] bg-[var(--color-surface)]'
              }`}
            >
              <BookOpen className="w-4 h-4 shrink-0 opacity-80" />
              <span className="truncate">{book.title}</span>
            </button>
          ))}
        </div>
      );
    }

    return (
      <div key={node.path} className="flex flex-col bg-[var(--color-surface)]">
        <button
          onClick={() => toggleExpand(node.path)}
          className="flex items-center gap-2.5 w-full text-right py-3 px-3.5 bg-[var(--color-surface)] hover:bg-[var(--color-secondary-subtle)] text-sm font-bold text-[var(--color-on-surface)] transition-colors"
        >
          {isExpanded ? (
            <ChevronLeft className="w-4 h-4 text-[var(--color-on-surface-variant)] shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[var(--color-on-surface-variant)] shrink-0" />
          )}
          {isExpanded ? (
            <FolderOpen className="w-4.5 h-4.5 text-[var(--color-primary)] shrink-0" />
          ) : (
            <Folder className="w-4.5 h-4.5 text-[var(--color-primary)] shrink-0" />
          )}
          <span className="truncate">{node.title}</span>
        </button>

        {isExpanded && (
          <div className="border-t border-[var(--color-outline-variant)] bg-[var(--color-surface-container)]/30 px-3 py-2 space-y-1">
            {node.categories?.map(child => renderTreeNode(child))}
            {filteredBooks.map(book => (
              <button
                key={book.bookId}
                onClick={() => handleSelectBookFromTree(book.bookId, book.title)}
                className={`flex items-center gap-2 w-full text-right py-2 px-2.5 rounded-[var(--radius-sm)] text-xs font-medium transition-all ${
                  selectedBookTitle === book.title
                    ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)] font-bold'
                    : 'hover:bg-[var(--color-secondary-subtle)] text-[var(--color-on-surface)]'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5 shrink-0 opacity-80" />
                <span className="truncate">{book.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="relative w-full h-[calc(100vh-4.5rem)] p-4 md:p-6 flex flex-col bg-[color-mix(in_srgb,var(--color-surface-container-high)_5%,var(--color-surface))] overflow-hidden" dir="rtl">
      {isProcessing && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 px-6 py-5 rounded-[var(--radius-lg)] bg-[var(--color-surface)]/95 shadow-2xl border border-[var(--color-outline-variant)]">
            <div className="w-16 h-16 rounded-full border-4 border-[var(--color-primary)] border-t-transparent animate-spin" />
            <span className="text-sm font-bold text-[var(--color-on-surface)]">הרצת האלגוריתם...</span>
          </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto w-full h-full flex flex-col min-h-0">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0 items-stretch">
        
        {/* Right Pane: Book Browser (4 Cols) */}
        <div className="lg:col-span-4 bg-[var(--color-surface-container-high)] text-[var(--color-on-surface)] rounded-[var(--radius-md)] shadow-sm border border-[var(--color-outline-variant)] flex flex-col h-full overflow-hidden">
          {/* Top Bar of Right Pane */}
          <div className="p-3.5 flex flex-col gap-2 shrink-0">
            <div className="flex items-center gap-2 w-full">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[var(--color-on-surface-variant)] absolute right-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="חיפוש מהיר בספרים..."
                  className="w-full pr-8 pl-3 py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-[var(--radius-sm)] focus:outline-none focus:border-[var(--color-primary)] text-[var(--color-on-surface)]"
                />
              </div>
              <label className="cursor-pointer shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--color-primary-subtle)] hover:brightness-95 text-[var(--color-primary)] rounded-[var(--radius-sm)] transition-colors border border-[var(--color-outline)]">
                <Upload className="w-3.5 h-3.5 text-current" />
                <span>ייבוא TXT</span>
                <input
                  type="file"
                  accept=".txt,.text"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {selectedBookTitle && (
                <button
                  onClick={() => {
                    setSelectedBookTitle(null);
                    setCommentaryContent('');
                  }}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-[var(--color-primary-subtle)] text-[var(--color-primary)] hover:opacity-90 rounded-[var(--radius-sm)] transition-colors border border-[var(--color-outline)]"
                  title="חזור לעץ הספרים"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>חזרה</span>
                </button>
              )}
            </div>
          </div>

          {/* Right Pane Body: Tree or Preview */}
          <div className="flex-1 overflow-y-auto p-4 bg-[var(--color-surface-container-high)]">
            {selectedBookTitle ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-[var(--color-primary-subtle)] p-3 rounded-[var(--radius-sm)] border border-[var(--color-outline)]">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-[var(--color-on-surface)]" />
                    <div>
                      <h4 className="text-sm font-bold text-[var(--color-on-surface)]">
                        {selectedBookTitle}
                      </h4>
                      <p className="text-xs text-[var(--color-on-surface-variant)]">
                        {commentaryContent.split(/\r?\n/).length} שורות נטענו
                      </p>
                    </div>
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-[var(--color-on-surface)]" />
                </div>

                <div className="bg-[var(--color-surface)] p-4 rounded-[var(--radius-sm)] border border-[var(--color-outline)] text-sm font-sans leading-relaxed text-[var(--color-on-surface)] max-h-[460px] overflow-y-auto whitespace-pre-wrap">
                  {loadingBookContent ? (
                    <div className="py-12 text-center text-[var(--color-on-surface-variant)]">טוען תוכן ספר...</div>
                  ) : (
                    commentaryContent.slice(0, 3000) + (commentaryContent.length > 3000 ? '\n\n...[המשך הספר נטען במלואו בעת הריצה]...' : '')
                  )}
                </div>
              </div>
            ) : (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-on-surface-variant)] mb-3 px-1">
                  עץ הספרים באוצריא
                </h3>
                
                {loadingTree ? (
                  <div className="py-12 text-center text-[var(--color-on-surface-variant)] text-xs">טוען את עץ הספרייה...</div>
                ) : tree ? (
                  searchQuery.trim() ? (
                    <div className="bg-[var(--color-surface)] border border-[var(--color-outline-variant)] rounded-[var(--radius-md)] flex flex-col divide-y divide-[var(--color-outline-variant)] overflow-hidden">
                      {getFlatBooksMatchingSearch(tree, searchQuery).map(book => (
                        <button
                          key={book.bookId}
                          onClick={() => handleSelectBookFromTree(book.bookId, book.title)}
                          className={`flex items-center gap-2 w-full text-right p-3 text-sm font-medium transition-all ${
                            selectedBookTitle === book.title
                              ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)] font-bold'
                              : 'hover:bg-[var(--color-secondary-subtle)] text-[var(--color-on-surface)]'
                          }`}
                        >
                          <BookOpen className="w-4 h-4 shrink-0 opacity-80" />
                          <div className="flex flex-col items-start truncate">
                            <span className="truncate">{book.title}</span>
                            {book.path && <span className="text-[10px] text-[var(--color-on-surface-variant)] truncate">{book.path}</span>}
                          </div>
                        </button>
                      ))}
                      {getFlatBooksMatchingSearch(tree, searchQuery).length === 0 && (
                        <div className="text-center text-xs text-[var(--color-on-surface-variant)] py-4">לא נמצאו ספרים התואמים לחיפוש</div>
                      )}
                    </div>
                  ) : (
                    renderTreeNode(tree)
                  )
                ) : (

                  <div className="text-xs text-[var(--color-on-surface-variant)] p-4">לא ניתן לטעון את עץ הספרים</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Middle & Left Area (8 Cols) */}
        <div className="lg:col-span-8 grid grid-cols-1 lg:grid-cols-2 gap-6 h-full items-stretch">
          {/* Middle Pane: Configuration & Settings */}
          <div className="flex flex-col gap-4 h-full">
            <div className="bg-[var(--color-surface-container-high)] text-[var(--color-on-surface)] rounded-[var(--radius-md)] shadow-sm border border-[var(--color-outline-variant)] flex flex-col flex-1 overflow-y-auto">
              <div className="p-3.5 flex items-center gap-2 shrink-0">
                <Settings2 className="w-5 h-5 text-[var(--color-primary)]" />
                <h3 className="text-sm font-bold text-[var(--color-on-surface)]">
                  אפיון והגדרות מיפוי
                </h3>
              </div>
              <div className="p-5 flex-1 overflow-y-auto">
                <div className="bg-[var(--color-surface)] border border-[var(--color-outline-variant)] rounded-[var(--radius-md)] flex flex-col divide-y divide-[var(--color-outline-variant)] overflow-hidden shadow-xs">
                  {/* Box 1: Source Category & Target Book */}
                  <div className="p-4 flex flex-col gap-5">
                    {/* Source Category Selection */}
                    <div className="space-y-2">
                      <label className="block text-[var(--color-on-surface-variant)] text-xs font-semibold">
                        קטגוריית מקור
                      </label>
                      <div className="flex bg-[var(--color-surface-container-high)] rounded-[var(--radius-md)] border border(--color-outline)] p-1">
                        <button
                          type="button"
                          onClick={() => setCategory('tanakh')}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs rounded-[var(--radius-sm)] transition-all ${
                            category === 'tanakh'
                              ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)] font-bold'
                              : 'text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] font-semibold bg-transparent'
                          }`}
                        >
                          {category === 'tanakh' && <Check className="w-3.5 h-3.5" />}
                          תנ"ך
                        </button>
                        <button
                          type="button"
                          onClick={() => setCategory('shas')}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs rounded-[var(--radius-sm)] transition-all ${
                            category === 'shas'
                              ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)] font-bold'
                              : 'text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] font-semibold bg-transparent'
                          }`}
                        >
                          {category === 'shas' && <Check className="w-3.5 h-3.5" />}
                          ש"ס
                        </button>
                      </div>
                    </div>
                    {/* Target Book Dropdown */}
                    <div className="space-y-2"> 
                      <label className="block text-[var(--color-on-surface-variant)] text-xs font-semibold flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-[var(--color-on-surface-variant)]" />
                        ספר מקור
                      </label>
                      <select
                        value={targetBook}
                        onChange={e => setTargetBook(e.target.value)}
                        className="w-full p-2.5 text-sm bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-[var(--radius-sm)] text-[var(--color-on-surface)] focus:outline-none focus:border-[var(--color-primary)]"
                      >
                        {(category === 'tanakh' ? TANAKH_BOOKS : SHAS_TRACTATES).map(book => (
                          <option key={book} value={book}>
                            {book}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  
                  {/* Box 2: Toggle for 'שם' in Shas */}
                  {category === 'shas' && (
                    <div className="p-4 flex items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <span className="block text-sm font-bold text-[var(--color-on-surface)]">
                          הפנה לדף הנוכחי במקום לרשת קישור ישיר
                        </span>
                        <span className="block text-xs text-[var(--color-on-surface-variant)]">
                          בחר פעולה זו כדי לנתב "שם" כהפניה למקום הנוכחי בגמרא
                        </span>
                      </div>
                      <ToggleSwitch 
                        checked={ignoreShamInShas}
                        onChange={setIgnoreShamInShas}
                        ariaLabel="הפנה לדף הנוכחי"
                      />
                    </div>
                  )}

                  {/* Box 3: Dibur Hamatchil Delimiter */}
                  <div className="p-4 space-y-1.5">
                    <label className="block text-sm font-bold text-[var(--color-on-surface)]">
                      תו סיום דיבור המתחיל
                    </label>
                    <input
                      type="text"
                      value={delimiter}
                      onChange={e => setDelimiter(e.target.value)}
                      placeholder="לדוגמה: . או -"
                      className="w-full p-2.5 text-sm bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-[var(--radius-sm)] text-[var(--color-on-surface)] focus:outline-none focus:border-[var(--color-primary)]"
                    />
                    <p className="text-xs text-[var(--color-on-surface-variant)]">
                      אם לא יוגדר תו סיום, האלגוריתם יזהה אוטומטית את ההתאמה הארוכה ביותר
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="shrink-0 py-4 text-center">
              <span className="text-sm font-semibold text-[var(--color-on-surface)]">
                {selectedBookTitle ? `ספר נבחר: ${selectedBookTitle}` : 'בחר ספר פירוש מימין כדי להתחיל'}
              </span>
            </div>
          </div>

          {/* Left Pane: Algorithm Settings */}
          <div className="flex flex-col gap-4 h-full">
            <div className="bg-[var(--color-surface-container-high)] text-[var(--color-on-surface)] rounded-[var(--radius-md)] shadow-sm border border-[var(--color-outline-variant)] flex flex-col flex-1 overflow-y-auto">
              <div className="p-3.5 flex items-center gap-2 shrink-0">
                <Settings2 className="w-5 h-5 text-[var(--color-primary)]" />
                <h3 className="text-sm font-bold text-[var(--color-on-surface)]">
                  הגדרות אלגוריתם
                </h3>
              </div>
              <div className="p-5 flex flex-col gap-5">
                <div className="bg-[var(--color-surface)] border border-[var(--color-outline-variant)] rounded-[var(--radius-md)] flex flex-col divide-y divide-[var(--color-outline-variant)] overflow-hidden">
                  {/* Rashei Teivot Abbreviation Expansion Settings */}
                  <div className="p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[var(--color-primary-subtle)] flex items-center justify-center shrink-0">
                          <Quote className="w-4 h-4 text-[var(--color-primary)]" />
                        </div>
                        <div className="space-y-0.5">
                          <span className="block text-sm font-bold text-[var(--color-on-surface)]">
                            תמיכה בפענוח ר"ת
                          </span>
                        </div>
                      </div>
                      <ToggleSwitch 
                        checked={useAbbreviationExpansion}
                        onChange={setUseAbbreviationExpansion}
                        ariaLabel="תמיכה בפענוח רתיבות"
                      />
                    </div>
                    
                    {useAbbreviationExpansion && (
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-xs text-[var(--color-on-surface-variant)]">
                          מילון: {customAbbreviations ? 'מותאם אישית' : 'מורחב מובנה'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowAbbrModal(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-[var(--color-secondary-subtle)] text-[var(--color-on-surface)] border border-[var(--color-outline)] hover:bg-[var(--color-outline-variant)] rounded-[var(--radius-pill)] transition-colors"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>ניהול / צפייה במילון</span>
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Fuzzy Matching Settings */}
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[var(--color-primary-subtle)] flex items-center justify-center shrink-0">
                          <ArrowLeftRight className="w-4 h-4 text-[var(--color-primary)]" />
                        </div>
                        <div className="space-y-0.5">
                          <span className="block text-sm font-bold text-[var(--color-on-surface)]">
                            השוואה גמישה קלה
                          </span>
                        </div>
                      </div>
                      <ToggleSwitch 
                        checked={useFuzzyMatching}
                        onChange={setUseFuzzyMatching}
                        ariaLabel="השוואה גמישה קלה"
                      />
                    </div>
                  </div>
                  {/* Word Weighting & TF-IDF Settings */}
                  <div className="p-4 flex flex-col gap-1">
                    <div className="flex items-center justify-between"> 
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[var(--color-primary-subtle)] flex items-center justify-center shrink-0"> 
                          <Scale className="w-4 h-4 text-[var(--color-primary)]" />
                        </div>
                        <div className="space-y-0.5">
                          <span className="block text-sm font-bold text-[var(--color-on-surface)]">
                            שקילת מילים
                          </span>
                        </div>
                      </div>
                      <ToggleSwitch 
                        checked={useWordWeighting}
                        onChange={setUseWordWeighting}
                        ariaLabel="שקילת מילים"
                      />
                    </div>
                    <span className="block text-xs text-[var(--color-on-surface-variant)] mt-1 mr-11">
                      הפחתת משקל מילים שכיחות
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                onClick={handleRun}
                disabled={!selectedBookTitle || isProcessing}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 text-sm font-bold bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:brightness-105 active:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-[var(--radius-md)] transition-all shadow-lg"
              >
                {isProcessing ? (
                  <span>מעבד מיפוי...</span>
                ) : (
                  <>
                    <Play className="w-5 h-5 text-[var(--color-on-primary)] fill-current" />
                    <span>הפעל אלגוריתם מיפוי</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Rashei Teivot Dictionary Modal */}
                  {showAbbrModal && (
        <AbbreviationsModal
          customDict={customAbbreviations ?? gsAbbreviations}
          onSaveDict={handleSaveDict}
          onClose={() => setShowAbbrModal(false)}
        />
      )}
    </div>
  </div>
);
};
