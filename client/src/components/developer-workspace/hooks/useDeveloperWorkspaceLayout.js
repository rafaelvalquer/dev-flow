import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { saveDeveloperWorkspacePreferences } from "../../../lib/developerWorkspace";
import { ensureStickyLayouts } from "../utils/developerTicketUtils";
import { DEFAULT_LAYOUTS } from "../utils/developerWidgetRegistry";

function sameLayouts(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

export function useDeveloperWorkspaceLayout({
  workspace,
  preferences,
  onWorkspaceSaved,
}) {
  const [layouts, setLayouts] = useState(workspace.layout || DEFAULT_LAYOUTS);
  const layoutsRef = useRef(layouts);
  const breakpointRef = useRef("lg");
  const layoutSaveTimer = useRef(null);

  useEffect(() => {
    const nextLayouts = ensureStickyLayouts(
      workspace.layout || DEFAULT_LAYOUTS,
      workspace.stickyNotes,
    );
    if (sameLayouts(layoutsRef.current, nextLayouts)) return;
    layoutsRef.current = nextLayouts;
    setLayouts(nextLayouts);
  }, [workspace.layout, workspace.stickyNotes]);

  useEffect(() => {
    return () => {
      window.clearTimeout(layoutSaveTimer.current);
    };
  }, []);

  async function persistLayouts(nextLayouts, options = {}) {
    layoutsRef.current = nextLayouts;
    setLayouts(nextLayouts);

    window.clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = window.setTimeout(async () => {
      try {
        const saved = await saveDeveloperWorkspacePreferences({
          preferences,
          layout: nextLayouts,
        });
        onWorkspaceSaved?.(saved);
      } catch (err) {
        if (options.toastOnError !== false) {
          toast.error("Não foi possível salvar a posição do workspace.", {
            description: err?.message || String(err),
          });
        }
      }
    }, options.delay ?? 350);
  }

  function handleLayoutChange(_layout, allLayouts) {
    if (sameLayouts(layoutsRef.current, allLayouts)) return;
    layoutsRef.current = allLayouts;
    setLayouts(allLayouts);
  }

  function handleBreakpointChange(nextBreakpoint) {
    breakpointRef.current = nextBreakpoint || "lg";
  }

  function saveBreakpointLayout(layout) {
    const breakpoint = breakpointRef.current || "lg";
    const nextLayouts = {
      ...layoutsRef.current,
      [breakpoint]: Array.isArray(layout) ? layout : layoutsRef.current?.[breakpoint] || [],
    };
    const normalized = ensureStickyLayouts(nextLayouts, workspace.stickyNotes);
    persistLayouts(normalized, { toastOnError: false, delay: 120 });
  }

  return {
    layouts,
    layoutsRef,
    persistLayouts,
    handleLayoutChange,
    handleBreakpointChange,
    saveBreakpointLayout,
  };
}
