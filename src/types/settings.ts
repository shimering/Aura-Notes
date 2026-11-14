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
  /** How long the S Pen side button must be held before the eraser arms. */
  spenHoldEraseMs: number;
  /** Whether a short S Pen button click opens the quick pen palette. */
  spenClickOpensMenu: boolean;
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
  spenHoldEraseMs: 250,
  spenClickOpensMenu: true,
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
