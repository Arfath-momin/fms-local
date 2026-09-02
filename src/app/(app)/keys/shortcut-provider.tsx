"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHotkeys } from "react-hotkeys-hook";
import { SHORTCUTS, newVoucherHref } from "@/lib/shortcuts";
import { EscapeStackProvider, useEscapeStack } from "./escape-layer";
import { ShortcutHelp } from "./shortcut-help";

/**
 * The app's keyboard, in one place.
 *
 * A fish merchant's clerk enters vouchers all day and came from Tally, where
 * the keyboard does everything and the mouse does very little. These bindings
 * are the same shape: Alt and the first letter of what you want.
 *
 * Nothing here changes what the app DOES — every shortcut goes where a link
 * already goes. A keyboard map that can only navigate cannot corrupt a voucher,
 * which is why it earns its place on a system that keeps books.
 */
function Keys({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const stack = useEscapeStack();
  const [helpOpen, setHelpOpen] = useState(false);

  /**
   * Has anything been typed on this screen since it opened?
   *
   * Tracked by listening for `input` events rather than by asking every form to
   * report itself — twelve forms each remembering to wire up a flag is twelve
   * chances for one to forget, and the one that forgets is the one that loses a
   * voucher. Reset on navigation, because a new screen starts clean.
   */
  const dirty = useRef(false);
  useEffect(() => {
    dirty.current = false;
  }, [pathname]);

  useEffect(() => {
    const onInput = () => {
      dirty.current = true;
    };
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, []);

  // A form that submits is no longer half-typed, whatever was entered into it.
  useEffect(() => {
    const onSubmit = () => {
      dirty.current = false;
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  const isTyping = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      el.isContentEditable
    );
  };

  /**
   * Escape, in the order a person means it.
   *
   *   1. Close whatever is open — a drawer over a form is what Escape is for.
   *   2. Leave the field. A merchant mid-figure means "stop editing this",
   *      not "abandon the voucher", and the second press then goes back.
   *   3. Ask, if the screen has been typed into. Going back discards it.
   *   4. Otherwise go back.
   *
   * Each step returns rather than falling through, so one press does one thing.
   */
  const onEscape = useCallback(() => {
    if (stack?.closeTop()) return;

    if (helpOpen) {
      setHelpOpen(false);
      return;
    }

    if (isTyping()) {
      (document.activeElement as HTMLElement).blur();
      return;
    }

    if (dirty.current) {
      const leave = window.confirm(
        "This screen has unsaved changes. Leave without saving?"
      );
      if (!leave) return;
      dirty.current = false;
    }

    router.back();
  }, [helpOpen, router, stack]);

  // enableOnFormTags, because Escape's whole job here is to get you OUT of a
  // field — the one binding that has to work while typing. Every other shortcut
  // deliberately does not fire in an input, or typing "p" in Particulars would
  // navigate away mid-voucher.
  useHotkeys("esc", onEscape, {
    enableOnFormTags: ["input", "textarea", "select"],
    enableOnContentEditable: true,
    preventDefault: true,
  });

  useHotkeys(
    SHORTCUTS.map((s) => s.combo).join(","),
    (_e, handler) => {
      const hit = SHORTCUTS.find((s) => s.combo === handler.hotkey);
      if (hit) router.push(hit.href);
    },
    { preventDefault: true },
    [router]
  );

  useHotkeys(
    "alt+n",
    () => {
      const href = newVoucherHref(pathname);
      if (href) router.push(href);
    },
    { preventDefault: true },
    [pathname, router]
  );

  // Shift+/ is what "?" actually is on a keyboard.
  useHotkeys("shift+slash", () => setHelpOpen((o) => !o), {
    preventDefault: true,
  });

  return (
    <>
      {children}
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  return (
    <EscapeStackProvider>
      <Keys>{children}</Keys>
    </EscapeStackProvider>
  );
}
