import { createContext, useContext } from 'react';

export interface SpacesUi {
  /** The member list is shown next to the channel (desktop ≥ 1280px). */
  membersOpen: boolean;
  toggleMembers: () => void;
  /** The window is wide enough for the member list pane (else it opens in a sheet). */
  canShowMembers: boolean;
}

export const SpacesUiContext = createContext<SpacesUi>({
  membersOpen: false,
  toggleMembers: () => {},
  canShowMembers: false,
});

export const useSpacesUi = () => useContext(SpacesUiContext);
