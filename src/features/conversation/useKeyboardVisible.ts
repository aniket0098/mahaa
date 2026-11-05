/**
 * useKeyboardVisible — whether the software keyboard currently covers the
 * bottom of the screen.
 *
 * Used by the conversation composer to drop the floating tab bar clearance
 * while the keyboard is open: the bar (`position: 'absolute'`) sits *behind*
 * the keyboard on Android 15+ (edge-to-edge makes `adjustResize` a no-op, the
 * keyboard just overlays the window), so keeping the clearance would leave a
 * tab-bar-sized blank gap between the input row and the keyboard.
 *
 * The events match the ones React Native's own `KeyboardAvoidingView` uses
 * (`keyboardWill*` on iOS for frame-accurate timing, `keyboardDid*` on Android
 * where the frame notification is not available), so this state flips in the
 * same frame the avoidance lift does — the two can never disagree. The
 * `Keyboard.isVisible()` seed covers remounting while the keyboard is already
 * up (e.g. returning to the screen with a focused input).
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState<boolean>(() => Keyboard.isVisible());

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const show = Keyboard.addListener(showEvent, () => setVisible(true));
    // Hide only when the keyboard is *fully* gone (`keyboardDidHide`, both
    // platforms): clearing the flag while the keyboard is still animating away
    // would restore the tab bar clearance mid-dismiss and visibly jump the row.
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return visible;
}
