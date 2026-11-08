import React, { useState, useEffect } from 'react';
import { 
  X, 
  Download, 
  Smartphone, 
  Share2, 
  PlusSquare, 
  CheckCircle2, 
  Laptop, 
  Sparkles,
  ExternalLink
} from 'lucide-react';

interface InstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  installPrompt: any;
  onInstallSuccess?: () => void;
}

export const InstallModal: React.FC<InstallModalProps> = ({
  isOpen,
  onClose,
  installPrompt,
  onInstallSuccess
}) => {
  const [activeTab, setActiveTab] = useState<'auto' | 'android' | 'ios' | 'desktop'>('auto');
  const [isStandalone, setIsStandalone] = useState(false);
  const [deviceType, setDeviceType] = useState<'android' | 'ios' | 'desktop'>('desktop');

  useEffect(() => {
    // Detect if already installed / standalone
    const isStandaloneMode = 
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(isStandaloneMode);

    // Detect user agent
    const ua = navigator.userAgent.toLowerCase();
    if (/android/.test(ua)) {
      setDeviceType('android');
      setActiveTab('android');
    } else if (/iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      setDeviceType('ios');
      setActiveTab('ios');
    } else {
      setDeviceType('desktop');
      setActiveTab('desktop');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePromptInstall = async () => {
    if (!installPrompt) return;
    try {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') {
        onInstallSuccess?.();
        onClose();
      }
    } catch (e) {
      console.warn('Install prompt failed:', e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-lg rounded-3xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-surface-subtle-light dark:border-surface-subtle-dark flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-violet-600 via-indigo-600 to-pink-500 flex items-center justify-center text-white shadow-md">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-ink-light dark:text-ink-dark flex items-center gap-2">
                Download Aura Notes
                {isStandalone && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 font-semibold">
                    Installed
                  </span>
                )}
              </h3>
              <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
                Add to your home screen for full-screen stylus inking
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-ink-muted-light hover:text-ink-light dark:text-ink-muted-dark dark:hover:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 1-Click Install Button if supported by current browser session */}
        {installPrompt && !isStandalone && (
          <div className="p-4 mx-6 mt-4 rounded-2xl bg-gradient-to-r from-violet-500/10 via-indigo-500/10 to-pink-500/10 border border-violet-500/20 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-left">
              <p className="text-sm font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-violet-500" /> Instant 1-Click Install
              </p>
              <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
                Your browser is ready to install the app right now.
              </p>
            </div>
            <button
              onClick={handlePromptInstall}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-md active:scale-95 transition flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              Install App Now
            </button>
          </div>
        )}

        {/* Device Tabs */}
        <div className="px-6 pt-4">
          <div className="flex p-1 bg-surface-subtle-light dark:bg-surface-subtle-dark rounded-xl text-xs font-medium">
            <button
              onClick={() => setActiveTab('android')}
              className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition ${
                activeTab === 'android'
                  ? 'bg-surface-light dark:bg-surface-dark text-violet-600 dark:text-violet-400 shadow-sm font-semibold'
                  : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-light'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Android / Samsung</span>
            </button>
            <button
              onClick={() => setActiveTab('ios')}
              className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition ${
                activeTab === 'ios'
                  ? 'bg-surface-light dark:bg-surface-dark text-violet-600 dark:text-violet-400 shadow-sm font-semibold'
                  : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-light'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>iPad / iPhone</span>
            </button>
            <button
              onClick={() => setActiveTab('desktop')}
              className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition ${
                activeTab === 'desktop'
                  ? 'bg-surface-light dark:bg-surface-dark text-violet-600 dark:text-violet-400 shadow-sm font-semibold'
                  : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-light'
              }`}
            >
              <Laptop className="w-3.5 h-3.5" />
              <span>PC / Mac</span>
            </button>
          </div>
        </div>

        {/* Content Instructions */}
        <div className="p-6 overflow-y-auto space-y-4 text-ink-light dark:text-ink-dark text-sm leading-relaxed">
          {activeTab === 'android' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-subtle-light/70 dark:bg-surface-subtle-dark/70">
                <div className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                  1
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-ink-light dark:text-ink-dark">Open the Browser Menu</p>
                  <p className="text-ink-muted-light dark:text-ink-muted-dark mt-0.5">
                    Tap the three dots (<strong>⋮</strong>) in the top-right of Chrome or bottom-right in Samsung Internet.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-subtle-light/70 dark:bg-surface-subtle-dark/70">
                <div className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                  2
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-ink-light dark:text-ink-dark">Tap "Add to Home screen" or "Install app"</p>
                  <p className="text-ink-muted-light dark:text-ink-muted-dark mt-0.5">
                    Select <strong>Add to Home screen</strong> or <strong>Install app</strong> from the list of options.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-subtle-light/70 dark:bg-surface-subtle-dark/70">
                <div className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                  3
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-ink-light dark:text-ink-dark">Confirm &amp; Launch</p>
                  <p className="text-ink-muted-light dark:text-ink-muted-dark mt-0.5">
                    Tap <strong>Add</strong> or <strong>Install</strong>. Aura Notes will appear on your Home Screen as an app icon with standalone full-screen support!
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ios' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-subtle-light/70 dark:bg-surface-subtle-dark/70">
                <div className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                  1
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-ink-light dark:text-ink-dark flex items-center gap-1">
                    Tap the Share Button <Share2 className="w-3.5 h-3.5 text-blue-500 inline" />
                  </p>
                  <p className="text-ink-muted-light dark:text-ink-muted-dark mt-0.5">
                    In Safari, tap the Share icon at the bottom of the screen (or top on iPad).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-subtle-light/70 dark:bg-surface-subtle-dark/70">
                <div className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                  2
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-ink-light dark:text-ink-dark flex items-center gap-1">
                    Select "Add to Home Screen" <PlusSquare className="w-3.5 h-3.5 text-ink-muted-light inline" />
                  </p>
                  <p className="text-ink-muted-light dark:text-ink-muted-dark mt-0.5">
                    Scroll down through the share options and tap <strong>Add to Home Screen</strong>.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-subtle-light/70 dark:bg-surface-subtle-dark/70">
                <div className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                  3
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-ink-light dark:text-ink-dark">Tap "Add"</p>
                  <p className="text-ink-muted-light dark:text-ink-muted-dark mt-0.5">
                    Tap <strong>Add</strong> in the top right corner. The Aura Notes icon is now added to your home screen!
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'desktop' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-subtle-light/70 dark:bg-surface-subtle-dark/70">
                <div className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                  1
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-ink-light dark:text-ink-dark">Look for the Install Icon in the URL Bar</p>
                  <p className="text-ink-muted-light dark:text-ink-muted-dark mt-0.5">
                    In Chrome or Microsoft Edge, look at the right end of the address bar for an <strong>Install</strong> or computer icon.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-subtle-light/70 dark:bg-surface-subtle-dark/70">
                <div className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                  2
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-ink-light dark:text-ink-dark">Or via Browser Settings Menu</p>
                  <p className="text-ink-muted-light dark:text-ink-muted-dark mt-0.5">
                    Click the 3 dots (<strong>⋮</strong>) in Chrome/Edge, select <strong>Cast, save, and share</strong> or <strong>Apps</strong> &rarr; <strong>Install Aura Notes</strong>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Benefits summary */}
          <div className="pt-2 border-t border-surface-subtle-light dark:border-surface-subtle-dark">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted-light dark:text-ink-muted-dark mb-2">
              Why download as an app?
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs text-ink-muted-light dark:text-ink-muted-dark">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>Full-screen canvas</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>Works offline anytime</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>Ultra-low S Pen latency</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>Direct Home Screen icon</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-subtle-light dark:border-surface-subtle-dark bg-surface-subtle-light/30 dark:bg-surface-subtle-dark/30 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-surface-subtle-light dark:bg-surface-subtle-dark text-ink-light dark:text-ink-dark hover:bg-surface-subtle-light/80 text-xs font-medium transition"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
