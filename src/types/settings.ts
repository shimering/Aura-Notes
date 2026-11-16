import { EraserMode, PenTool } from './note';

type ViewMode = 'text' | 'ink';

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
  /** Shortest S Pen button press treated as a hold; shorter presses open the quick palette. */
  spenHoldEraseMs: number;
  /** Whether a hover double-press of the S Pen button opens the quick pen palette. */
  spenDoublePressOpensMenu: boolean;
  syncVaultKey: string;
  autoSyncEnabled: boolean;
  syncThemeAndLayout: boolean;
  syncStylusPrefs: boolean;
  lastSyncedAt?: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  viewMode: 'ink',
  isSidebarOpen: true,
  stylusOnly: false,
  defaultPenTool: 'fountain',
  defaultPenColor: '#1e293b',
  defaultPenWidth: 4,
  defaultEraserWidth: 24,
  defaultEraserMode: 'object',
  spenHoldEraseMs: 250,
  spenDoublePressOpensMenu: true,
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
