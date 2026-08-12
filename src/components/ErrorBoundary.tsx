import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6 text-right" dir="rtl">
          <div className="max-w-xl w-full bg-slate-800 rounded-2xl p-6 shadow-2xl border border-slate-700 space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-8 h-8 shrink-0" />
              <h1 className="text-lg font-bold">אירעה שגיאה בטעינת האפליקציה</h1>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              התרחשה שגיאה בלתי צפויה ברכיבי הממשק. אנא רענן את העמוד או נסה להריץ מחדש.
            </p>

            {this.state.error && (
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-[11px] text-rose-300 overflow-x-auto whitespace-pre-wrap max-h-48">
                {this.state.error.toString()}
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-colors shadow-md"
              >
                <RefreshCw className="w-4 h-4" />
                <span>רענן אפליקציה</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
