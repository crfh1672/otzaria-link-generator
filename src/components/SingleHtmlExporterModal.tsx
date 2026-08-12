import React, { useState } from 'react';
import { X, Code, Download, Github, CheckCircle2, FileCode } from 'lucide-react';
import JSZip from 'jszip';
import { notifySuccess, notifyError } from '../utils/otzariaBridge';

interface SingleHtmlExporterModalProps {
  onClose: () => void;
}

export const SingleHtmlExporterModal: React.FC<SingleHtmlExporterModalProps> = ({ onClose }) => {
  const [downloading, setDownloading] = useState(false);

  const handleDownloadOtzpluginZip = async () => {
    setDownloading(true);
    try {
      const zip = new JSZip();

      // Read manifest.json format
      const manifest = {
        schemaVersion: 1,
        id: "com.otzaria.links-generator",
        name: "מחולל קישורים",
        version: "1.0.0",
        description: "תוסף אוצריא לייצור קישורים (links.json) והדגשת דיבור המתחיל (ד\"ה)",
        author: "מפתח אוצריא",
        homepage: "https://github.com/Otzaria/otzaria",
        entrypoint: "index.html",
        minAppVersion: "0.9.93",
        sdkVersion: "1.x",
        stability: "stable",
        permissions: [
          "app.info.read",
          "library.books.read",
          "library.content.read",
          "plugin.storage.read",
          "plugin.storage.write",
          "ui.feedback",
          "events.subscribe:theme.changed"
        ],
        network: {
          enabled: false,
          allowlist: []
        },
        contributes: {
          toolTab: {
            title: "מחולל קישורים",
            order: 150,
            allowOrderBeforeBuiltIns: false,
            defaultPinned: true,
            iconName: "link_24_regular"
          }
        }
      };

      zip.file("manifest.json", JSON.stringify(manifest, null, 2));

      // Get current index.html DOM content or generate bundled single HTML
      const htmlContent = document.documentElement.outerHTML;
      zip.file("index.html", htmlContent);

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "com.otzaria.links-generator.otzplugin";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      notifySuccess('קובץ החבילה otzplugin. ייוצא בהצלחה!');
    } catch (e) {
      console.error(e);
      notifyError('שגיאה ביצירת קובץ ה-otzplugin');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadSingleHtml = () => {
    try {
      const docHtml = `<!DOCTYPE html>
<html lang="he" dir="rtl">
${document.documentElement.innerHTML}
</html>`;

      const blob = new Blob([docHtml], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "otzaria-links-plugin.html";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      notifySuccess('קובץ HTML בודד ייוצא בהצלחה!');
    } catch (e) {
      console.error(e);
      notifyError('שגיאה בהורדת קובץ HTML בודד');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[var(--color-surface)] text-[var(--color-on-surface)] rounded-2xl border border-[var(--color-outline-variant)] shadow-xl max-w-lg w-full overflow-hidden text-right">
        {/* Header */}
        <div className="p-4 bg-[var(--color-surface-container-high)] border-b border-[var(--color-outline)] flex items-center justify-between">
          <div className="flex items-center gap-2 text-[var(--color-on-surface)] font-bold text-sm">
            <Code className="w-4.5 h-4.5 text-current" />
            <span>קימפול וייצוא התוסף עבור אוצריא ו-GitHub</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--color-on-surface-variant)] hover:bg-[var(--color-secondary-subtle)] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs text-[var(--color-on-surface)] bg-[var(--color-surface-container-high)]">
          <div className="bg-[var(--color-primary-subtle)] border border-[var(--color-outline)] p-3.5 rounded-xl space-y-1.5">
            <h4 className="font-bold text-[var(--color-on-surface)] flex items-center gap-1.5">
              <Github className="w-4 h-4 text-current" />
              <span>תאימות מלאה להוראות SDK תוספי אוצריא</span>
            </h4>
            <p className="text-[var(--color-on-surface-variant)] leading-relaxed">
              התוסף מוכן לייצוא כחבילת <code className="font-mono bg-[var(--color-surface)] px-1 py-0.5 rounded-md border border-[var(--color-outline)]">.otzplugin</code> עבור התקנה ישרות באוצריא, או כקובץ HTML בודד מקומפל המתאים ל-GitHub Releases ו-CI Actions.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <div className="p-3.5 bg-[var(--color-surface)] rounded-xl border border-[var(--color-outline-variant)] flex items-center justify-between gap-3 shadow-2xs">
              <div>
                <h5 className="font-bold text-[var(--color-on-surface)] flex items-center gap-1.5">
                  <FileCode className="w-4 h-4 text-current" />
                  <span>קובץ .otzplugin עבור התקנה באוצריא</span>
                </h5>
                <p className="text-[11px] text-[var(--color-on-surface-variant)] mt-0.5">
                  כולל manifest.json מעודכן, הרשאות SDK v1.x וקובץ הכניסה
                </p>
              </div>
              <button
                onClick={handleDownloadOtzpluginZip}
                disabled={downloading}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 font-bold bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90 rounded-xl transition-all shadow-2xs shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>הורד .otzplugin</span>
              </button>
            </div>

            <div className="p-3.5 bg-[var(--color-surface)] rounded-xl border border-[var(--color-outline-variant)] flex items-center justify-between gap-3 shadow-2xs">
              <div>
                <h5 className="font-bold text-[var(--color-on-surface)] flex items-center gap-1.5">
                  <Code className="w-4 h-4 text-current" />
                  <span>קובץ HTML בודד (Single HTML Bundle)</span>
                </h5>
                <p className="text-[11px] text-[var(--color-on-surface-variant)] mt-0.5">
                  דף אינטרנט עצמאי שרץ בכל דפדפן או כתוסף ב-WebView
                </p>
              </div>
              <button
                onClick={handleDownloadSingleHtml}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 font-bold bg-emerald-700 text-white dark:bg-emerald-600 hover:opacity-90 rounded-xl transition-all shadow-2xs shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>הורד HTML בודד</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-[var(--color-surface-container-high)] border-t border-[var(--color-outline)] text-left">
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
