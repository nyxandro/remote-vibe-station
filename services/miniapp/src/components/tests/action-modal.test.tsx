/**
 * @fileoverview Tests for shared ActionModal open/close animation behavior.
 *
 * Test suites:
 * - ActionModal - Verifies delayed unmount during close animation and stable dialog rendering.
 */

/* @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActionModal } from "../ActionModal";

describe("ActionModal", () => {
  afterEach(() => {
    /* Reset DOM and timer state between animation scenarios so delayed-unmount assertions stay deterministic. */
    cleanup();
    vi.useRealTimers();
  });

  it("keeps the dialog mounted during close animation before removing it", () => {
    /* Smooth close animation requires the modal to stay in DOM briefly after isOpen flips false. */
    vi.useFakeTimers();

    const { rerender } = render(
      <ActionModal isOpen title="Animated modal" onClose={vi.fn()}>
        <div>Modal body</div>
      </ActionModal>
    );

    expect(screen.getByRole("dialog", { name: "Animated modal" })).toBeTruthy();

    rerender(
      <ActionModal isOpen={false} title="Animated modal" onClose={vi.fn()}>
        <div>Modal body</div>
      </ActionModal>
    );

    expect(screen.getByRole("dialog", { name: "Animated modal" })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(220);
    });

    expect(screen.queryByRole("dialog", { name: "Animated modal" })).toBeNull();
  });
});
