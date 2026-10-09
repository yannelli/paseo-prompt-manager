import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, StatusBar, TextInput, type KeyboardEvent, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, type View } from "react-native";

const native = Platform.OS === "ios" || Platform.OS === "android";

/** How far the keyboard covers the view given `ref` and `onLayout`. Paseo screens do not resize for it. */
export function useKeyboardInset() {
  const ref = useRef<View>(null);
  const keyboardTop = useRef<number | null>(null);
  const [inset, setInset] = useState(0);
  const [visible, setVisible] = useState(false);
  const measure = () => {
    const top = keyboardTop.current;
    if (top === null || !ref.current) return setInset(0);
    // A measurement that lands after the keyboard hid, or after it moved, must not reapply a stale inset.
    ref.current.measureInWindow((_x, y, _width, height) => { if (keyboardTop.current === top) setInset(Math.max(0, Math.round(y + height - top))); });
  };
  useEffect(() => {
    if (!native) return;
    const show = (event: KeyboardEvent) => {
      // `screenY` is in screen coordinates, but Android's `measureInWindow` leaves the status bar out of its window coordinates.
      keyboardTop.current = event.endCoordinates.screenY - (Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0);
      setVisible(true);
      measure();
    };
    const hide = () => {
      keyboardTop.current = null;
      setVisible(false);
      setInset(0);
    };
    const subscriptions = Platform.OS === "ios"
      ? [Keyboard.addListener("keyboardWillShow", show), Keyboard.addListener("keyboardWillHide", hide)]
      : [Keyboard.addListener("keyboardDidShow", show), Keyboard.addListener("keyboardDidHide", hide)];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);
  return { ref, onLayout: measure, inset, visible, dismiss: () => Keyboard.dismiss() };
}

/** Scroll view props that bring the focused input back into view when the keyboard shrinks the viewport. */
export function useRevealFocusedInput() {
  const ref = useRef<ScrollView>(null);
  const offset = useRef(0);
  const viewport = useRef(0);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = event.nativeEvent.contentOffset.y; };
  const onLayout = (event: LayoutChangeEvent) => {
    viewport.current = event.nativeEvent.layout.height;
    const input = TextInput.State.currentlyFocusedInput();
    const scroll = ref.current?.getNativeScrollRef?.();
    if (!native || !input || !scroll) return;
    scroll.measureInWindow((_x, scrollY) => input.measureInWindow((_inputX, inputY, _width, height) => {
      const y = inputY - scrollY;
      const fits = height <= viewport.current - 24;
      // A tall editor only needs its top in view; native caret tracking handles the rest.
      if (fits ? y >= 0 && y + height <= viewport.current : y + 40 <= viewport.current) return;
      const delta = y < 0 ? y - 8 : Math.min(y - 8, y + height - viewport.current + 16);
      ref.current?.scrollTo({ y: Math.max(0, offset.current + delta), animated: true });
    }));
  };
  return { ref, onScroll, onLayout, scrollEventThrottle: 32 };
}
