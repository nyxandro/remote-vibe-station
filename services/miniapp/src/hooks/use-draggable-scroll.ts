/**
 * @fileoverview Custom hook for enabling grab-to-scroll (drag-to-scroll) functionality on a container.
 *
 * Exports:
 * - useDraggableScroll - Returns refs and handlers to attach to a scrollable element.
 */

import { useState, useRef, useCallback } from "react";

/**
 * Hook to implement mouse-drag horizontal scrolling for desktop users.
 * Mimics mobile swipe behavior on PC using mouse events.
 */
export const useDraggableScroll = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    /* Grabbing should only start if clicking the background or non-interactive elements. */
    const target = e.target as HTMLElement;
    const isInteractive = target.closest("button, a, input, select, textarea, [draggable=true]");
    if (isInteractive) return;

    setIsDragging(true);

    /* x-position relates to the board container to keep movements stable when the whole page scrolls. */
    setStartX(e.pageX - (ref.current?.offsetLeft || 0));
    setScrollLeft(ref.current?.scrollLeft || 0);
  }, []);

  const onMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const onMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !ref.current) {
      return;
    }

    /* Prevent text selection while "swiping" with the mouse. */
    e.preventDefault();

    const x = e.pageX - ref.current.offsetLeft;
    const walk = (x - startX) * 1.5; /* Scroll speed multiplier for a more responsive feel. */
    ref.current.scrollLeft = scrollLeft - walk;
  }, [isDragging, scrollLeft, startX]);

  return {
    ref,
    isDragging,
    handlers: {
      onMouseDown,
      onMouseLeave,
      onMouseUp,
      onMouseMove
    }
  };
};
