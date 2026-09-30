import { createContext, useContext } from 'react';
import type { AppData } from '../data/app-data';

export interface UiContextValue {
  app: AppData;
  openItem: (itemId: number) => void;
}

export const UiContext = createContext<UiContextValue | null>(null);

export function useUi(): UiContextValue {
  const v = useContext(UiContext);
  if (!v) throw new Error('UiContext is missing');
  return v;
}
