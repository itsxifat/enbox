import { create } from 'zustand';

/** Set right before registering: the app opens /welcome (profile setup) once signed in. */
export const useOnboarding = create(() => ({ pending: false }));
