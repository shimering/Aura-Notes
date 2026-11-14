import React, { useState, useEffect } from 'react';
import { 
  X, 
  Cloud, 
  CloudCheck, 
  RefreshCw, 
  Copy, 
  Check, 
  Link as LinkIcon, 
  Download, 
  Upload, 
  Smartphone, 
  Laptop, 
  Sparkles,
  ShieldCheck,
  AlertCircle,
  QrCode,
  FileText
} from 'lucide-react';
import { Note } from '../types/note';
import { AppSettings } from '../types/settings';
import {
  generateRandomVaultKey, 
  exportVaultToJson, 
  exportAllNotesAsMarkdown,
  parseVaultJson 
} from '../services/syncService';
import { AccountPanel } from './AccountPanel';

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  notes: Note[];
  settings: AppSettings;
  onSync: (vaultKey: string) => Promise<void>;
  onImportVault: (importedNotes: Note[], importedSettings?: Partial<AppSettings>) => Promise<void>;
  onUpdateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  isSyncing: boolean;
  syncError: string | null;
}

export const SyncModal: React.FC<SyncModalProps> = ({
  isOpen,
  onClose,
  notes,
  settings,
  onSync,
  onImportVault,
  onUpdateSettings,
  isSyncing,
  syncError
}) => {
  const [inputVaultKey, setInputVaultKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  useEffect(() => {
    if (settings.syncVaultKey) {
      setInputVaultKey(settings.syncVaultKey);
    }
  }, [settings.syncVaultKey]);

  if (!isOpen) return null;

  const currentVaultKey = settings.syncVaultKey;
  const isConnected = !!currentVaultKey;

  const handleCopyKey = () => {
    if (!currentVaultKey) return;
    navigator.clipboard.writeText(currentVaultKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const getDirectSyncUrl = () => {
    const origin = window.location.origin;
    const path = window.location.pathname;
    return `${origin}${path}?sync=${encodeURIComponent(currentVaultKey)}`;
  };

  const handleCopyLink = () => {
    if (!currentVaultKey) return;
    const url = getDirectSyncUrl();
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCreateNewVault = async () => {
    const newKey = generateRandomVaultKey();
    await onSync(newKey);
  };

  const handleConnectExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVaultKey.trim()) return;
    await onSync(inputVaultKey.trim());
  };

  const handleDisconnect = async () => {
    if (confirm('Disconnect this device from the cloud vault? Local notes will remain on this device.')) {
      await onUpdateSettings({ syncVaultKey: '' });
      setInputVaultKey('');
    }
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        const { notes: importedNotes, settings: importedSettings } = parseVaultJson(text);
        await onImportVault(importedNotes, importedSettings);
        setImportStatus(`Successfully restored ${importedNotes.length} notes!`);
        setTimeout(() => setImportStatus(null), 3000);
      } catch (err: any) {
        alert(err.message || 'Failed to import backup file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const formatLastSync = () => {
    if (!settings.lastSyncedAt) return 'Never';
    const seconds = Math.floor((Date.now() - settings.lastSyncedAt) / 1000);
    if (seconds < 10) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return new Date(settings.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 select-none">
      <div 
        className="w-full max-w-xl rounded-3xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-surface-subtle-light dark:border-surface-subtle-dark flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-violet-600 via-indigo-600 to-sky-500 flex items-center justify-center text-white shadow-md">
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-ink-light dark:text-ink-dark flex items-center gap-2">
                Cross-Device Sync
                {isConnected && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Active
                  </span>
                )}
              </h3>
              <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
                Synchronize notes, ink strokes, and settings between your devices
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

        {/* Error message banner */}
        {syncError && (
          <div className="mx-6 mt-4 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 flex items-center gap-2.5 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{syncError}</span>
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-ink-light dark:text-ink-dark text-sm">
          {/* Optional Sign in with Freebuff account */}
          <AccountPanel />

          {isConnected ? (
            /* Active Vault Section */
            <div className="space-y-4">
              <div className="p-5 rounded-3xl bg-gradient-to-br from-violet-500/10 via-indigo-500/10 to-sky-500/10 border border-violet-500/20 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wider">
                    Connected Sync Vault
                  </span>
                  <div className="flex items-center gap-2 text-xs text-ink-muted-light dark:text-ink-muted-dark">
                    <span>Last Synced: <strong>{formatLastSync()}</strong></span>
                  </div>
                </div>

                {/* Vault Key Display */}
                <div className="flex items-center justify-between p-3 rounded-2xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark gap-2">
                  <div className="font-mono text-sm font-bold text-ink-light dark:text-ink-dark truncate select-all">
                    {currentVaultKey}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={handleCopyKey}
                      title="Copy Vault Key"
                      className="px-2.5 py-1.5 rounded-xl text-xs font-medium bg-surface-subtle-light dark:bg-surface-subtle-dark hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-1 transition active:scale-95"
                    >
                      {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey ? 'Copied' : 'Key'}</span>
                    </button>
                    <button
                      onClick={handleCopyLink}
                      title="Copy 1-Click Sync Link for other devices"
                      className="px-2.5 py-1.5 rounded-xl text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 flex items-center gap-1 transition active:scale-95 shadow-sm"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5" /> : <LinkIcon className="w-3.5 h-3.5" />}
                      <span>{copiedLink ? 'Link Copied!' : 'Share Link'}</span>
                    </button>
                  </div>
                </div>

                {/* Actions: Sync Now & Disconnect */}
                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => onSync(currentVaultKey)}
                    disabled={isSyncing}
                    className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-md active:scale-95 transition flex items-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'Syncing Now...' : 'Sync Now'}</span>
                  </button>

                  <button
                    onClick={handleDisconnect}
                    className="text-xs text-red-500 hover:text-red-600 underline-offset-2 hover:underline transition"
                  >
                    Disconnect Vault
                  </button>
                </div>
              </div>

              {/* Step-by-step Guide to Pair 2nd Device */}
              <div className="p-4 rounded-2xl bg-surface-subtle-light/60 dark:bg-surface-subtle-dark/60 border border-surface-subtle-light dark:border-surface-subtle-dark space-y-2">
                <p className="text-xs font-semibold text-ink-light dark:text-ink-dark flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-violet-500" />
                  Connect your Samsung Galaxy Tab, iPad, or Phone:
                </p>
                <ol className="text-xs text-ink-muted-light dark:text-ink-muted-dark space-y-1.5 pl-4 list-decimal leading-relaxed">
                  <li>
                    Open <strong>Aura Notes</strong> on your other device (or tap <strong>Share Link</strong> above and send it to your device).
                  </li>
                  <li>
                    Open <strong>Cloud Sync</strong>, enter key <code className="px-1.5 py-0.5 rounded bg-surface-light dark:bg-surface-dark font-mono text-violet-600 dark:text-violet-400 font-semibold">{currentVaultKey}</code>, and tap <strong>Connect</strong>.
                  </li>
                  <li>
                    All notes, drawings, and settings will instantly mirror across both devices!
                  </li>
                </ol>
              </div>
            </div>
          ) : (
            /* Setup New Vault or Connect */
            <div className="space-y-5">
              {/* Option A: Create New Vault */}
              <div className="p-5 rounded-3xl bg-surface-subtle-light/70 dark:bg-surface-subtle-dark/70 border border-surface-subtle-light dark:border-surface-subtle-dark space-y-3">
                <div>
                  <h4 className="font-semibold text-sm text-ink-light dark:text-ink-dark flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-500" />
                    Option 1: Create a New Sync Vault
                  </h4>
                  <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark mt-1">
                    Start a secure cloud vault. You'll receive a key you can use to pair your other devices.
                  </p>
                </div>
                <button
                  onClick={handleCreateNewVault}
                  disabled={isSyncing}
                  className="w-full py-2.5 px-4 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs shadow-md transition active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Cloud className="w-4 h-4" />
                  <span>{isSyncing ? 'Creating & Syncing...' : 'Create New Sync Vault'}</span>
                </button>
              </div>

              {/* Option B: Join Existing Vault */}
              <div className="p-5 rounded-3xl bg-surface-subtle-light/70 dark:bg-surface-subtle-dark/70 border border-surface-subtle-light dark:border-surface-subtle-dark space-y-3">
                <div>
                  <h4 className="font-semibold text-sm text-ink-light dark:text-ink-dark flex items-center gap-2">
                    <LinkIcon className="w-4 h-4 text-sky-500" />
                    Option 2: Connect with Existing Key
                  </h4>
                  <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark mt-1">
                    Already created a vault on your tablet or laptop? Enter its key below:
                  </p>
                </div>
                <form onSubmit={handleConnectExisting} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. aura-sync-k7p9-2m4w"
                    value={inputVaultKey}
                    onChange={(e) => setInputVaultKey(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs rounded-xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark outline-none focus:ring-2 focus:ring-violet-500 text-ink-light dark:text-ink-dark font-mono"
                  />
                  <button
                    type="submit"
                    disabled={isSyncing || !inputVaultKey.trim()}
                    className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs shadow-md transition active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <span>Connect</span>
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Sync Preferences & Toggles */}
          <div className="pt-2 border-t border-surface-subtle-light dark:border-surface-subtle-dark space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted-light dark:text-ink-muted-dark">
              Sync Preferences
            </h4>

            <div className="space-y-2">
              <label className="flex items-center justify-between p-3 rounded-2xl bg-surface-subtle-light/50 dark:bg-surface-subtle-dark/50 cursor-pointer hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition">
                <div>
                  <p className="text-xs font-semibold text-ink-light dark:text-ink-dark">
                    Auto-Sync in Background
                  </p>
                  <p className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark mt-0.5">
                    Automatically syncs when notes are edited or when switching tabs
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoSyncEnabled}
                  onChange={(e) => onUpdateSettings({ autoSyncEnabled: e.target.checked })}
                  className="w-4 h-4 accent-violet-600 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl bg-surface-subtle-light/50 dark:bg-surface-subtle-dark/50 cursor-pointer hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition">
                <div>
                  <p className="text-xs font-semibold text-ink-light dark:text-ink-dark">
                    Sync Theme &amp; View Mode
                  </p>
                  <p className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark mt-0.5">
                    Sync Dark/Light mode and Split/Text/Canvas view across devices
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.syncThemeAndLayout}
                  onChange={(e) => onUpdateSettings({ syncThemeAndLayout: e.target.checked })}
                  className="w-4 h-4 accent-violet-600 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl bg-surface-subtle-light/50 dark:bg-surface-subtle-dark/50 cursor-pointer hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition">
                <div>
                  <p className="text-xs font-semibold text-ink-light dark:text-ink-dark">
                    Sync Stylus &amp; Inking Preferences
                  </p>
                  <p className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark mt-0.5">
                    Sync default pen type, stroke thickness, color, and palm shield
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.syncStylusPrefs}
                  onChange={(e) => onUpdateSettings({ syncStylusPrefs: e.target.checked })}
                  className="w-4 h-4 accent-violet-600 cursor-pointer"
                />
              </label>
            </div>
          </div>

          {/* Offline Backup & Restore Section */}
          <div className="pt-2 border-t border-surface-subtle-light dark:border-surface-subtle-dark space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted-light dark:text-ink-muted-dark">
              Offline File Backup &amp; Migration
            </h4>
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <button
                onClick={() => exportVaultToJson(notes, settings)}
                className="w-full sm:flex-1 py-2 px-3 rounded-xl bg-surface-subtle-light dark:bg-surface-subtle-dark hover:bg-surface-subtle-light/80 text-ink-light dark:text-ink-dark text-xs font-medium border border-surface-subtle-light dark:border-surface-subtle-dark transition flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Vault (JSON)</span>
              </button>

              <label className="w-full sm:flex-1 py-2 px-3 rounded-xl bg-surface-subtle-light dark:bg-surface-subtle-dark hover:bg-surface-subtle-light/80 text-ink-light dark:text-ink-dark text-xs font-medium border border-surface-subtle-light dark:border-surface-subtle-dark transition flex items-center justify-center gap-1.5 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Import Backup File</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileImport}
                  className="hidden"
                />
              </label>
            </div>

            <button
              onClick={() => exportAllNotesAsMarkdown(notes)}
              disabled={notes.length === 0}
              className="w-full py-2 px-3 rounded-xl bg-surface-subtle-light dark:bg-surface-subtle-dark hover:bg-surface-subtle-light/80 text-ink-light dark:text-ink-dark text-xs font-medium border border-surface-subtle-light dark:border-surface-subtle-dark transition flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Export All Notes as Markdown (.md)</span>
            </button>
            {importStatus && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                {importStatus}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-subtle-light dark:border-surface-subtle-dark bg-surface-subtle-light/30 dark:bg-surface-subtle-dark/30 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-ink-muted-light dark:text-ink-muted-dark">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Encrypted in transit &amp; local-first</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-md active:scale-95 transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
