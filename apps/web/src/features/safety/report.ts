/**
 * Opening the report flow from anywhere (message, profile and Space menus): `openReport(target)`
 * shows <ReportDialogHost/>, mounted once in AppShell. The safety builder owns this folder.
 */
import { create } from 'zustand';
import type { ID, ReportTarget } from '@enbox/shared';

export interface ReportTargetInfo {
  targetType: ReportTarget;
  targetId: ID;
  /** Who the report is about (offered "also block"); null for a Space. */
  userId: ID | null;
  /** Shown in the dialog ("Report message from Alice"). */
  label: string;
}

interface ReportState {
  target: ReportTargetInfo | null;
  open: (target: ReportTargetInfo) => void;
  close: () => void;
}

export const useReport = create<ReportState>()((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

export const openReport = (target: ReportTargetInfo) => useReport.getState().open(target);
