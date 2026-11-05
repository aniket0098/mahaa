/**
 * Tracks the system "reduce motion" accessibility setting.
 *
 * The navigation transitions (the hub's fade between sections, and the sliding
 * indicator on its bar) are decorative; when the user has asked the OS for
 * reduced motion, every one of them collapses to an instant state change. The
 * setting is read once on mount and then kept live, so a change in the system
 * accessibility panel takes effect without a restart.
 *
 * **The first transition may still animate.** `isReduceMotionEnabled` is
 * async, so the very first frames render with the default (`false`) until the
 * native answer arrives — one short transition at most, then the setting is
 * honoured for every subsequent one.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReducedMotion(enabled);
      })
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}
