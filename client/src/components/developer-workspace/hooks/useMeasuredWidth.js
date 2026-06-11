import { useLayoutEffect, useRef, useState } from "react";

export function useMeasuredWidth() {
  const containerRef = useRef(null);
  const [state, setState] = useState({ mounted: false, width: 0 });

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    function updateWidth() {
      const nextWidth = Math.max(0, Math.round(node.getBoundingClientRect().width || 0));
      setState((current) =>
        current.mounted && current.width === nextWidth
          ? current
          : { mounted: true, width: nextWidth },
      );
    }

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return {
    width: state.width,
    containerRef,
    mounted: state.mounted && state.width > 0,
  };
}
