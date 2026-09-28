/**
 * `useReduceMotion` — the OS "reduce motion" preference, as a React value.
 *
 * The feed uses it for one thing: the full-screen viewer's open/close
 * transition, which is a large full-screen animation. When the preference is on
 * the viewer appears immediately instead.
 *
 * It reads `AccessibilityInfo` rather than Reanimated's hook so the viewer stays
 * free of a motion runtime it does not otherwise need, and it subscribes to
 * changes so a preference toggled while the app is open takes effect.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;

    // The initial read is asynchronous; a rejection leaves the default (false)
    // in place, which is the safe direction — motion is only removed when the
    // platform actually says so.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (active) setReduceMotion(enabled);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
