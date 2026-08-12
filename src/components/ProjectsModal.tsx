import React, { useEffect, useState } from 'react';
import { SessionState } from '../types';
import { listCacheKeys, getFromCache, removeFromCache, notifySuccess, notifyError } from '../utils/otzariaBridge';
import { X, FolderOpen, Trash2, Clock, FileText, ArrowRight } from 'lucide-react';

interface ProjectsModalProps {
  onLoadSession: (session: SessionState) => void;
  onClose: () => void;
}

export const ProjectsModal: React.FC<ProjectsModalProps> = ({ onLoadSession, onClose }) => {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSavedProjects = async () => {
    setLoading(true);
    try {
      const keys = await listCacheKeys();
      const loaded: SessionState[] = [];
      for (const k of keys) {
        const item = await getFromCache<SessionState>(k);
        if (item && item.commentaryTitle && item.links) {
          loaded.push(item);
        }
      }
      loaded.sort((a, b) => (b.lastModifiedTimestamp || 0) - (a.lastModifiedTimestamp || 0));
      setSessions(loaded);
    } catch (e) {
      console.error(e);
      notifyError('שגיאה בטעינת פרויקטים שמורים');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSavedProjects();
  }, []);

  const handleDelete = async (id: string, title: string) => {
    // @ts-ignore
    const res = await window.Otzaria.call('ui.showConfirm', {
      title: 'אישור מחיקה',
      content: `האם למחוק את הפרויקט "${title}"?`
    });
    if (!res.success || !res.data.confirmed) return;
    
    try {
      await removeFromCache(id);
      notifySuccess('הפרויקט שנבחר נמחק בהצלחה');
      fetchSavedProjects();
    } catch {
      notifyError('שגיאה במחיקת פרויקט');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[var(--color-surface)] text-[var(--color-on-surface)] rounded-2xl border border-[var(--color-outline-variant)] shadow-xl max-w-lg w-full overflow-hidden text-right flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 bg-[var(--color-surface-container-high)] border-b border-[var(--color-outline)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-[var(--color-on-surface)] font-bold text-sm">
            <FolderOpen className="w-4.5 h-4.5 text-current" />
            <span>פרויקטים ומטמון שמור באוצריא</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--color-on-surface-variant)] hover:bg-[var(--color-secondary-subtle)] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1 bg-[var(--color-surface-container-high)]">
          {loading ? (
            <div className="py-12 text-center text-xs text-[var(--color-on-surface-variant)]">טוען פרויקטים שמורים...</div>
          ) : sessions.length === 0 ? (
            <div className="py-12 text-center text-[var(--color-on-surface-variant)] text-xs">
              לא נמצאו פרויקטים שמורים במטמון
            </div>
          ) : (
            sessions.map(s => (
              <div
                key={s.id}
                className="bg-[var(--color-surface)] p-3.5 rounded-xl border border-[var(--color-outline-variant)] hover:border-[var(--color-primary)] transition-all flex items-center justify-between gap-3 shadow-2xs"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-current shrink-0" />
                    <h4 className="text-xs font-bold text-[var(--color-on-surface)] truncate">
                      {s.commentaryTitle}
                    </h4>
                    <span className="text-[10px] bg-[var(--color-secondary-subtle)] text-[var(--color-on-surface)] px-1.5 py-0.5 rounded-md border border-[var(--color-outline)]">
                      {s.config?.targetBookName}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-[var(--color-on-surface-variant)]">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(s.lastModifiedTimestamp).toLocaleString('he-IL')}
                    </span>
                    <span>• {s.links?.length || 0} קישורים</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleDelete(s.id, s.commentaryTitle)}
                    className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                    title="מחק פרויקט"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => {
                      onLoadSession(s);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-bold bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90 rounded-xl shadow-2xs transition-all"
                  >
                    <span>טען</span>
                    <ArrowRight className="w-3 h-3 rotate-180" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[var(--color-surface-container-high)] border-t border-[var(--color-outline)] text-left shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold bg-[var(--color-secondary-subtle)] text-[var(--color-on-surface)] rounded-xl hover:bg-[var(--color-outline-variant)] border border-[var(--color-outline)] transition-colors"
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  );
};
