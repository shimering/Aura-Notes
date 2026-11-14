import { ViewMode } from '../components/Header';
import { EraserMode, PenTool } from './note';

export interface AppSettings {
  theme: 'light' | 'dark';
  viewMode: ViewMode;
  isSidebarOpen: boolean;
  stylusOnly: boolean;
  defaultPenTool: PenTool;
  defaultPenColor: string;
  defaultPenWidth: number;
  defaultEraserWidth: number;
  defaultEraserMode: EraserMode;
  syncVaultKey: string;
  autoSyncEnabled: boolean;
  syncThemeAndLayout: boolean;
  syncStylusPrefs: boolean;
  lastSyncedAt?: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  viewMode: 'both',
  isSidebarOpen: true,
  stylusOnly: false,
  defaultPenTool: 'fountain',
  defaultPenColor: '#1e293b',
  defaultPenWidth: 4,
  defaultEraserWidth: 24,
  defaultEraserMode: 'object',
  syncVaultKey: '',
  autoSyncEnabled: true,
  syncThemeAndLayout: true,
  syncStylusPrefs: true,
  updatedAt: Date.now(),
};

export interface SyncVaultPayload {
  vaultKey: string;
  notes: any[];
  settings: Partial<AppSettings>;
  deletedNoteIds?: string[];
  updatedAt: number;
  clientDeviceId?: string;
}
