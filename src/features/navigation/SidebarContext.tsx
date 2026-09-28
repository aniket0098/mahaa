import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface SidebarContextValue {
  isOpen: boolean;
  /**
   * Stays true through the close animation so the drawer can slide out before it
   * is unmounted. It is set from the open/close actions themselves rather than
   * from an effect, which is what keeps the two synchronised without a
   * render-time ref read.
   */
  isMounted: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  /** Called by the drawer once its close animation has finished. */
  finishClose: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const openSidebar = useCallback(() => {
    setIsMounted(true);
    setIsOpen(true);
  }, []);

  const closeSidebar = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsOpen((prev) => {
      if (prev) {
        return false;
      }
      setIsMounted(true);
      return true;
    });
  }, []);

  const finishClose = useCallback(() => {
    setIsMounted(false);
  }, []);

  const value = useMemo(
    () => ({
      isOpen,
      isMounted,
      openSidebar,
      closeSidebar,
      toggleSidebar,
      finishClose,
    }),
    [isOpen, isMounted, openSidebar, closeSidebar, toggleSidebar, finishClose],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
