import React, { useState, useEffect } from 'react';
import { SessionState, PluginConfig } from './types';
import { runLinkingParser } from './utils/parserAlgorithm';
import { TopToolbar } from './components/TopToolbar';
import { SetupMode } from './components/SetupMode';
import { EditMode } from './components/EditMode';
import { ProjectsModal } from './components/ProjectsModal';

import { saveToCache, getFromCache, listCacheKeys, notifySuccess, notifyError } from './utils/otzariaBridge';

export default function App() {
  const [mode, setMode] = useState<'setup' | 'edit'>('setup');
  const [session, setSession] = useState<SessionState | null>(null);

  // Modals & Navigation state
  const [showProjectsModal, setShowProjectsModal] = useState(false);
  
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false);
  const [sortMode, setSortMode] = useState<'book_order' | 'score_asc' | 'score_desc'>('book_order');

  // Listen for Otzaria plugin events (plugin.boot, theme.changed) and fetch initial theme
  useEffect(() => {
    const applyTheme = (theme: any) => {
      if (!theme || !theme.colorScheme) return;
      const cs = theme.colorScheme;
      const r = document.documentElement;

      if (cs.primary) r.style.setProperty('--color-primary', cs.primary);
      if (cs.onPrimary) r.style.setProperty('--color-on-primary', cs.onPrimary);
      if (cs.secondary) r.style.setProperty('--color-secondary', cs.secondary);
      if (cs.onSecondary) r.style.setProperty('--color-on-secondary', cs.onSecondary);
      if (cs.secondaryContainer) r.style.setProperty('--color-secondary-container', cs.secondaryContainer);
      if (cs.onSecondaryContainer) r.style.setProperty('--color-on-secondary-container', cs.onSecondaryContainer);
      if (cs.surface) r.style.setProperty('--color-surface', cs.surface);
      if (cs.onSurface) r.style.setProperty('--color-on-surface', cs.onSurface);
      if (cs.surfaceContainerHigh) r.style.setProperty('--color-surface-container-high', cs.surfaceContainerHigh);
      if (cs.surfaceContainerHighest) r.style.setProperty('--color-surface-container-highest', cs.surfaceContainerHighest);
      if (cs.error) r.style.setProperty('--color-error', cs.error);
      if (cs.onError) r.style.setProperty('--color-on-error', cs.onError);
      if (cs.outline) r.style.setProperty('--color-outline', cs.outline);

      const hexToRgba = (hex: string, alpha: number) => {
        if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return `rgba(138, 75, 39, ${alpha})`;
        const red = parseInt(hex.slice(1, 3), 16) || 0;
        const green = parseInt(hex.slice(3, 5), 16) || 0;
        const blue = parseInt(hex.slice(5, 7), 16) || 0;
        return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
      };

      if (cs.primary) r.style.setProperty('--color-primary-subtle', hexToRgba(cs.primary, 0.12));
      if (cs.secondary) r.style.setProperty('--color-secondary-subtle', hexToRgba(cs.secondary, 0.12));
      
      if (cs.surface) document.body.style.background = cs.surface;
      if (cs.onSurface) document.body.style.color = cs.onSurface;

      document.body.classList.toggle('dark-mode', theme.mode === 'dark');

      if (theme.typography) {
        const t = theme.typography;
        if (t.fontFamily) {
          r.style.setProperty('--font-main', `'${t.fontFamily}', 'FrankRuhlCLM', 'David', serif`);
        }
        if (t.fontSize) {
          r.style.setProperty('--font-size-base', `${t.fontSize}px`);
        }
        if (t.lineHeight) {
          r.style.setProperty('--line-height', String(t.lineHeight));
        }
      }
    };

    if (typeof window !== 'undefined' && window.Otzaria) {
      if (window.Otzaria.on) {
        window.Otzaria.on('plugin.boot', (payload: any) => {
          if (payload?.theme) applyTheme(payload.theme);
        });

        window.Otzaria.on('theme.changed', (theme: any) => {
          if (theme) applyTheme(theme);
        });
      }

      if (window.Otzaria.call) {
        window.Otzaria.call('app.getTheme').then(res => {
          if (res && res.success && res.data) {
            applyTheme(res.data);
          }
        }).catch(() => {});
      }
    }
  }, []);

  // Run the 5-Step Parser algorithm and switch to Edit Mode
  const handleRunAlgorithm = (
    commentaryText: string,
    commentaryTitle: string,
    config: PluginConfig,
    sourceText: string,
    rashiText?: string,
    tosafotText?: string,
    rashiLinks?: any[],
    tosafotLinks?: any[]
  ) => {
    try {
      const parsed = runLinkingParser(
        commentaryText,
        sourceText,
        config,
        rashiText,
        tosafotText,
        rashiLinks,
        tosafotLinks
      );

      const sessionId = `session_${Date.now()}`;
      const newSession: SessionState = {
        id: sessionId,
        commentaryFileName: `${commentaryTitle}.txt`,
        commentaryTitle,
        config,
        links: parsed.links,
        commentaryLines: parsed.commentaryLines,
        sourceLines: parsed.sourceLines,
        rashiLines: parsed.rashiLines,
        tosafotLines: parsed.tosafotLines,
        dhHighlights: parsed.dhHighlights,
        lastModifiedTimestamp: Date.now()
      };

      setSession(newSession);
      setMode('edit');
      notifySuccess(`אלגוריתם המיפוי הופעל בהצלחה: נוצרו ${parsed.links.length} קישורים`);
    } catch (e) {
      console.error(e);
      notifyError('אירעה שגיאה בעת הרצת האלגוריתם');
    }
  };

  const handleSaveSession = async () => {
    if (!session) return;
    try {
      const updated = { ...session, lastModifiedTimestamp: Date.now() };
      await saveToCache(session.id, updated);
      setSession(updated);
      notifySuccess('הפרויקט נשמר בהצלחה למטמון המקומי באוצריא');
    } catch (e) {
      console.error(e);
      notifyError('שגיאה בשמירת הפרויקט למטמון');
    }
  };

  const handleLoadSession = (loadedSession: SessionState) => {
    setSession(loadedSession);
    setMode('edit');
    notifySuccess(`פרויקט "${loadedSession.commentaryTitle}" נטען בהצלחה`);
  };

  return (
    <div className="min-h-screen bg-[var(--color-surface)] text-[var(--color-on-surface)] flex flex-col font-sans">
      {/* Top Fixed Toolbar */}
      <TopToolbar
        session={session}
        mode={mode}
        onSaveSession={handleSaveSession}
        onOpenProjects={() => setShowProjectsModal(true)}
        
        onReturnToSetup={() => setMode('setup')}
        isNavDrawerOpen={isNavDrawerOpen}
        onToggleNavDrawer={() => setIsNavDrawerOpen(prev => !prev)}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
      />

      {/* Main Mode View */}
      <main className="flex-1 pb-12">
        {mode === 'setup' ? (
          <SetupMode onRunAlgorithm={handleRunAlgorithm} />
        ) : (
          session && (
            <EditMode
              session={session}
              onUpdateSession={updated => {
                setSession(updated);
              }}
              isNavDrawerOpen={isNavDrawerOpen}
              onCloseNavDrawer={() => setIsNavDrawerOpen(false)}
              onToggleNavDrawer={() => setIsNavDrawerOpen(prev => !prev)}
              sortMode={sortMode}
            />
          )
        )}
      </main>

      {/* Modals */}
      {showProjectsModal && (
        <ProjectsModal
          onLoadSession={handleLoadSession}
          onClose={() => setShowProjectsModal(false)}
        />
      )}

    </div>
  );
}
