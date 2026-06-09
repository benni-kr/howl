import { useState, useEffect } from "react";

export const useStageSize = (options?: { hasSidebar?: boolean }) => {
  const [size, setSize] = useState(() => {
    const isMobile = window.innerWidth <= 1024;
    const sidebarWidth = (options?.hasSidebar && !isMobile) ? 280 : 0;
    
    const w = Math.max(
      300,
      Math.min(1000, window.innerWidth - sidebarWidth - 48)
    );
    const h = isMobile
      ? w
      : Math.max(300, Math.min(720, window.innerHeight - 230));
      
    return { width: w, height: h };
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const update = () => {
      const isMobile = window.innerWidth <= 1024;
      const sidebarWidth = (options?.hasSidebar && !isMobile) ? 280 : 0;
      
      const width = Math.max(
        300,
        Math.min(1000, window.innerWidth - sidebarWidth - 48)
      );
      
      const height = isMobile 
        ? width 
        : Math.max(300, Math.min(720, window.innerHeight - 230));
        
      setSize({ width, height });
    };

    // Call update immediately in case the layout changed between initial render and effect execution
    update();
    
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [options?.hasSidebar]);

  return size;
};
