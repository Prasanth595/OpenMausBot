import { Children, Fragment, cloneElement, createElement, isValidElement } from "react";
import type { ElementType, ReactElement, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Props one part contributes to the element it renders. */
export interface PartProps {
  ref?: unknown;
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

/** Calls the caller's handler first, then ours, when both are set. */
function chainHandlers(theirs: unknown, ours: unknown): unknown {
  if (typeof theirs !== "function") return ours;
  if (typeof ours !== "function") return theirs;
  return (...args: unknown[]) => {
    (theirs as (...callArgs: unknown[]) => void)(...args);
    (ours as (...callArgs: unknown[]) => void)(...args);
  };
}

/** Combines our ref with one the caller already put on their element. */
function chainRefs(theirs: unknown, ours: unknown): unknown {
  if (theirs === undefined) return ours;
  if (ours === undefined) return theirs;
  return (node: unknown) => {
    for (const ref of [theirs, ours]) {
      if (typeof ref === "function") (ref as (value: unknown) => void)(node);
      else if (ref) (ref as { current: unknown }).current = node;
    }
  };
}

/**
 * Merges the props one part contributes into props an element already has:
 * the element's own props win, except that classes concatenate (ours last, so
 * the part's own classNames still lose to a caller's utility for the same
 * property) and event handlers run the element's first, then ours.
 */
export function mergePartProps(theirs: PartProps, ours: PartProps): PartProps {
  const merged: PartProps = { ...theirs };
  for (const [key, value] of Object.entries(ours)) {
    if (value === undefined) continue;
    if (key === "ref") {
      merged.ref = chainRefs(theirs.ref, value);
    } else if (key === "className") {
      merged.className = cn(theirs.className, value as string);
    } else if (key.startsWith("on")) {
      merged[key] = chainHandlers(theirs[key], value);
    } else if (theirs[key] === undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Renders one part of a compound component. Without `as` the part is its
 * default tag carrying our props; with `as={Fragment}` our props are merged
 * onto the caller's single element child, so their element, classes and
 * handlers stay theirs. Any other `as` renders that element type with our
 * props, and the caller's own props (already merged in) winning.
 */
export function renderPart(
  as: ElementType | undefined,
  defaultTag: ElementType,
  ours: PartProps,
  children: ReactNode,
): ReactNode {
  if (as === Fragment) {
    const elements = Children.toArray(children).filter(isValidElement) as ReactElement<PartProps>[];
    if (elements.length !== 1) {
      throw new Error("`as={Fragment}` needs exactly one element child to merge the tab props onto.");
    }
    const [child] = elements;
    return cloneElement(child, mergePartProps(child.props, ours));
  }
  const Tag = (as ?? defaultTag) as ElementType<PartProps>;
  return createElement(Tag, ours, children);
}
