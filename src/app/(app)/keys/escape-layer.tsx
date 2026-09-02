"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";

/**
 * What Escape means depends on what is open, so the handlers form a STACK.
 *
 * A drawer, a confirm step, a dialog — each pushes itself while it is open and
 * pops when it closes. Escape calls the topmost and stops there. Without this,
 * one global handler would navigate away from a half-typed expense because the
 * merchant meant to close the drawer over it, and the work would be gone.
 *
 * Last in, first out: the thing opened most recently is the thing on top, which
 * is the thing a person means when they press Escape.
 */
type Layer = { id: number; close: () => void };

type Stack = {
  push: (layer: Layer) => void;
  pop: (id: number) => void;
  /** Closes the topmost layer. True when there was one. */
  closeTop: () => boolean;
};

const EscapeStack = createContext<Stack | null>(null);

export function EscapeStackProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // A ref, not state: pushing a layer must not re-render the whole app, and
  // nothing reads the stack during render.
  const layers = useRef<Layer[]>([]);

  const push = useCallback((layer: Layer) => {
    layers.current.push(layer);
  }, []);

  const pop = useCallback((id: number) => {
    layers.current = layers.current.filter((l) => l.id !== id);
  }, []);

  const closeTop = useCallback(() => {
    const top = layers.current.at(-1);
    if (!top) return false;
    // Popped before closing: a close handler that unmounts its own component
    // would otherwise pop an already-empty entry on the way out.
    layers.current = layers.current.slice(0, -1);
    top.close();
    return true;
  }, []);

  return (
    <EscapeStack.Provider value={{ push, pop, closeTop }}>
      {children}
    </EscapeStack.Provider>
  );
}

let nextId = 1;

/**
 * Claim Escape while `open` is true.
 *
 * Anything that covers the screen should call this — a drawer, a confirm, a
 * picker. `close` is called with no arguments and should do exactly what the
 * component's own close button does.
 */
export function useEscapeLayer(open: boolean, close: () => void) {
  const stack = useContext(EscapeStack);
  // The latest close, without re-registering the layer on every render — a
  // component that rebuilds its handler each time would otherwise push and pop
  // itself off the stack continuously. Written in an effect rather than during
  // render, which React rejects and would be a real hazard here: the ref is
  // read by Escape at any moment, and a value assigned during a render that is
  // then thrown away would leave a stale handler behind it.
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });

  useEffect(() => {
    if (!open || !stack) return;
    const id = nextId++;
    stack.push({ id, close: () => latest.current() });
    return () => stack.pop(id);
  }, [open, stack]);
}

/** Used by the global handler. Null outside the provider, which is not an error. */
export function useEscapeStack() {
  return useContext(EscapeStack);
}
