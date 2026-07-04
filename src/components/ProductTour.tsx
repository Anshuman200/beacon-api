"use client";

import { useEffect, useRef } from "react";
import { driver, type DriverHook } from "driver.js";
import confetti from "canvas-confetti";
import "driver.js/dist/driver.css";
import { useSeederStore } from "@/store/seederStore";
import { TOUR_STEPS } from "@/lib/tour";

/**
 * Drives the "Help & Tour" button in Header.tsx — previously a dead stub that
 * flipped `tourActive` with nothing anywhere reading it. Renders nothing
 * itself; it just watches that flag and drives the actual DOM tour.
 *
 * Also auto-starts the tour once for a first-time visitor (tracked via the
 * persisted `hasSeenTour` flag), so nobody has to discover the Help button
 * on their own to find out this exists.
 */
export default function ProductTour() {
  const tourActive = useSeederStore((state) => state.tourActive);
  const setTourActive = useSeederStore((state) => state.setTourActive);
  const setActiveView = useSeederStore((state) => state.setActiveView);
  const hasSeenTour = useSeederStore((state) => state.hasSeenTour);
  const setHasSeenTour = useSeederStore((state) => state.setHasSeenTour);
  const autoStartedRef = useRef(false);

  // First-time-visitor auto-start — marks itself seen immediately so it only
  // ever fires once regardless of whether the tour is finished or skipped.
  // Deliberately no cleanup here: this is a one-shot action guarded by a ref
  // (not meant to be cancelable), and React's dev-mode Strict Mode double-
  // invoke would otherwise cancel the real timeout via the phantom first
  // mount's cleanup before it ever fires.
  useEffect(() => {
    if (hasSeenTour || autoStartedRef.current) return;
    autoStartedRef.current = true;
    setHasSeenTour(true);
    setTimeout(() => setTourActive(true), 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tourActive) return;

    // Every highlighted element lives in the Builder view — switch to it so
    // the targets actually exist, whether the tour was started from Runner or not.
    setActiveView("client");

    // Give the view switch a frame to render before driver.js measures element positions.
    const timeout = setTimeout(() => {
      // A little celebration on genuine completion (not on early exit/skip) —
      // onDoneClick fires specifically for the last step's button, distinct
      // from onNextClick which covers every other step's "Next".
      const onDoneClick: DriverHook = (_el, _step, opts) => {
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        opts.driver.destroy();
      };
      const steps = TOUR_STEPS.map((step, i) =>
        i === TOUR_STEPS.length - 1 ? { ...step, popover: { ...step.popover, onDoneClick } } : step
      );

      const tourDriver = driver({
        showProgress: true,
        allowClose: true,
        overlayOpacity: 0.65,
        steps,
        onDestroyed: () => setTourActive(false),
      });
      tourDriver.drive();
    }, 150);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourActive]);

  return null;
}
