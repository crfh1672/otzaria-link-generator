import React, { useState, useEffect } from 'react';
import { DEFAULT_ABBREVIATIONS } from '../data/abbreviations';
import { X, Search, Plus, Trash2, Upload, Download, RefreshCw, Check, BookOpen, FileCode } from 'lucide-react';

interface AbbreviationsModalProps {
  customDict?: Record<string, string[]>;
  onSaveDict: (dict: Record<string, string[]> | undefined) => void;
  onClose: () => void;
}

export const AbbreviationsModal: React.FC<AbbreviationsModalProps> = ({
  customDict,
  onSaveDict,
  onClose,
}) => {
  const [dict, setDict] = useState<Record<string, string[]>>(
    customDict || DEFAULT_ABBREVIATIONS
  );
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setDict(customDict || DEFAULT_ABBREVIATIONS);
  }, [customDict]);
  const [editingAbbr, setEditingAbbr] = useState<string | null>(null);
  const [newOptionInput, setNewOptionInput] = useState('');

  // States for adding a brand new abbreviation
  const [newAbbrKey, setNewAbbrKey] = useState('');
  const [newAbbrOptionsText, setNewAbbrOptionsText] = useState('');
  const [isAddingNew, setIsAddingNew] = useState(false);

  // Filter entries
  const entries = Object.entries(dict).filter(([key, options]) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    if (key.toLowerCase().includes(q)) return true;
    return options.some(opt => opt.toLowerCase().includes(q));
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          // Validate structure
          const validDict: Record<string, string[]> = {};
          Object.entries(parsed).forEach(([k, v]) => {
            if (Array.isArray(v)) {
              validDict[k] = v.map(item => String(item).trim()).filter(Boolean);
            } else if (typeof v === 'string') {
              validDict[k] = [v.trim()];
            }
          });

          setDict(validDict);
          // @ts-ignore
          await window.Otzaria.call('ui.showMessage', { message: `נטען מילון ראשי תיבות בהצלחה! נטענו ${Object.keys(validDict).length} ערכים.` });
        } else {
          // @ts-ignore
          await window.Otzaria.call('ui.showError', { message: 'קובץ ה-JSON חייב להכיל אובייקט של ראשי תיבות ומערך אפשרויות.' });
        }
      } catch (err) {
        // @ts-ignore
        await window.Otzaria.call('ui.showError', { message: 'שגיאה בפענוח קובץ ה-JSON: ' + String(err) });
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dict, null, 4));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "rashei_teivot_dictionary.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleResetToDefault = async () => {
    // @ts-ignore
    const res = await window.Otzaria.call('ui.showConfirm', {
      title: 'איפוס מילון',
      content: 'האם לחזור למילון ראשי התיבות המהוודר כברירת מחדל?'
    });
    if (res.success && res.data.confirmed) {
      setDict(DEFAULT_ABBREVIATIONS);
    }
  };

  const handleSaveAndClose = () => {
    if (dict === DEFAULT_ABBREVIATIONS) {
      onSaveDict(undefined);
    } else {
      onSaveDict(dict);
    }
    onClose();
  };

  const handleAddOption = (key: string) => {
    if (!newOptionInput.trim()) return;
    setDict(prev => ({
      ...prev,
      [key]: [...(prev[key] || []), newOptionInput.trim()]
    }));
    setNewOptionInput('');
  };

  const handleRemoveOption = (key: string, optionIndex: number) => {
    setDict(prev => ({
      ...prev,
      [key]: prev[key].filter((_, idx) => idx !== optionIndex)
    }));
  };

  const handleDeleteAbbrKey = (key: string) => {
    setDict(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleAddNewAbbr = () => {
    if (!newAbbrKey.trim()) return;
    const opts = newAbbrOptionsText
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    setDict(prev => ({
      ...prev,
      [newAbbrKey.trim()]: opts
    }));

    setNewAbbrKey('');
    setNewAbbrOptionsText('');
    setIsAddingNew(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 md:p-4">
      <div className="bg-[var(--color-surface)] text-[var(--color-on-surface)] rounded-2xl border border-[var(--color-outline-variant)] shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden text-right" dir="rtl">
        {/* Modal Header */}
        <div className="p-4 bg-[var(--color-surface-container-high)] border-b border-[var(--color-outline)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-[var(--color-on-surface)] font-bold text-sm md:text-base">
            <BookOpen className="w-5 h-5 text-[var(--color-primary)]" />
            <span>מילון ראשי תיבות והרחבות</span>
            <span className="bg-[var(--color-primary-subtle)] text-[var(--color-primary)] px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold">
              {Object.keys(dict).length} ערכים
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[var(--color-on-surface-variant)] hover:bg-[var(--color-secondary-subtle)] rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Toolbar: Search, Upload JSON, Export, Reset */}
        <div className="p-3 bg-[var(--color-surface-container-high)] border-b border-[var(--color-outline)] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-on-surface-variant)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="סינון ראשי תיבות או אפשרויות..."
              className="w-full pr-9 pl-3 py-1.5 text-xs md:text-sm bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-xl text-[var(--color-on-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAddingNew(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-[var(--color-primary)] text-[var(--color-on-primary)] rounded-xl hover:opacity-90 transition-all shadow-2xs"
            >
              <Plus className="w-4 h-4" />
              <span>הוסף ראשי תיבות</span>
            </button>

            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-[var(--color-surface)] hover:bg-[var(--color-secondary-subtle)] text-[var(--color-on-surface)] rounded-xl transition-colors border border-[var(--color-outline)]">
              <Upload className="w-3.5 h-3.5 text-current" />
              <span>טען קובץ JSON</span>
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={handleExportJSON}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-[var(--color-surface)] hover:bg-[var(--color-secondary-subtle)] text-[var(--color-on-surface)] rounded-xl transition-colors border border-[var(--color-outline)]"
              title="הורד קובץ JSON מעודכן"
            >
              <Download className="w-3.5 h-3.5 text-current" />
              <span>ייצוא JSON</span>
            </button>

            <button
              type="button"
              onClick={handleResetToDefault}
              className="p-2 text-[var(--color-on-surface-variant)] hover:bg-[var(--color-secondary-subtle)] rounded-xl transition-colors border border-[var(--color-outline)]"
              title="איפוס למילון ברירת מחדל"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 md:p-5 flex-1 overflow-y-auto space-y-4 bg-[var(--color-surface-container-high)]">
          {/* Add New Entry Form Drawer */}
          {isAddingNew && (
            <div className="bg-[var(--color-surface)] p-4 rounded-xl border border-[var(--color-primary)] shadow-md space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-[var(--color-primary)]">הוספת ראשי תיבות חדשים:</h4>
                <button onClick={() => setIsAddingNew(false)} className="text-xs text-[var(--color-on-surface-variant)]">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[var(--color-on-surface)] mb-1">
                    ראשי תיבות (לדוגמה: א"א):
                  </label>
                  <input
                    type="text"
                    value={newAbbrKey}
                    onChange={e => setNewAbbrKey(e.target.value)}
                    placeholder='א"א'
                    className="w-full p-2 text-xs bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-lg text-[var(--color-on-surface)] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--color-on-surface)] mb-1">
                    אפשרויות פתיחה (שורה עבור כל אפשרות):
                  </label>
                  <textarea
                    value={newAbbrOptionsText}
                    onChange={e => setNewAbbrOptionsText(e.target.value)}
                    placeholder={'אי אפשר\nאמר אברהם\nאריך אנפין'}
                    rows={3}
                    className="w-full p-2 text-xs bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-lg text-[var(--color-on-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddingNew(false)}
                  className="px-3 py-1.5 text-xs font-bold text-[var(--color-on-surface-variant)] hover:bg-[var(--color-secondary-subtle)] rounded-lg"
                >
                  ביטול
                </button>
                <button
                  type="button"
                  onClick={handleAddNewAbbr}
                  className="px-4 py-1.5 text-xs font-bold bg-[var(--color-primary)] text-[var(--color-on-primary)] rounded-lg shadow-2xs"
                >
                  שמור ערך חדש
                </button>
              </div>
            </div>
          )}

          {/* Abbreviation Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {entries.length === 0 ? (
              <div className="col-span-2 p-8 text-center text-xs md:text-sm text-[var(--color-on-surface-variant)] bg-[var(--color-surface)] rounded-xl border border-dashed border-[var(--color-outline)] font-medium">
                לא נמצאו ראשי תיבות תואמים לחיפוש
              </div>
            ) : (
              entries.map(([key, options]) => (
                <div
                  key={key}
                  className="bg-[var(--color-surface)] p-3.5 rounded-xl border border-[var(--color-outline-variant)] hover:border-[var(--color-outline)] shadow-2xs space-y-2 flex flex-col justify-between"
                >
                  <div>
                    {/* Header line of card */}
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--color-outline-variant)]">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold font-mono px-2 py-0.5 rounded-md bg-[var(--color-primary-subtle)] text-[var(--color-primary)]">
                          {key}
                        </span>
                        <span className="text-[11px] text-[var(--color-on-surface-variant)] font-medium">
                          ({options.length} אפשרויות)
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteAbbrKey(key)}
                        className="text-rose-500 hover:text-rose-700 p-1 rounded-md hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        title="מחק ראשי תיבות אלו"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Options Pills */}
                    <div className="mt-2.5 flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                      {options.map((opt, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[var(--color-surface-container-high)] text-[var(--color-on-surface)] rounded-lg border border-[var(--color-outline-variant)] group"
                        >
                          <span>{opt}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveOption(key, idx)}
                            className="text-[var(--color-on-surface-variant)] hover:text-rose-500 opacity-60 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Add option to existing key */}
                  <div className="pt-2 flex items-center gap-1.5 border-t border-[var(--color-outline-variant)] mt-2">
                    <input
                      type="text"
                      placeholder="הוסף אפשרות פתיחה נוספת..."
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          handleAddOption(key);
                        }
                      }}
                      onChange={e => setNewOptionInput(e.target.value)}
                      className="flex-1 px-2.5 py-1 text-[11px] bg-[var(--color-surface-container-high)] border border-[var(--color-outline-variant)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] text-[var(--color-on-surface)]"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[var(--color-surface-container-high)] border-t border-[var(--color-outline)] flex items-center justify-between shrink-0">
          <span className="text-xs text-[var(--color-on-surface-variant)]">
            במהלך המיפוי, האלגוריתם יחפש במקור איזו מבין האפשרויות הנ"ל קיימת בפועל בטקסט המקביל.
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-[var(--color-on-surface-variant)] hover:bg-[var(--color-secondary-subtle)] rounded-xl transition-colors"
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={handleSaveAndClose}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90 rounded-xl transition-all shadow-2xs"
            >
              <Check className="w-4 h-4" />
              <span>שמור מילון והחל</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
