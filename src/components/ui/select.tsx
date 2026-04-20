"use client";

/**
 * Select — a custom popover menu that replaces the native <select>.
 *
 * The native <select> element hands off rendering to the host OS, which
 * means an iOS wheel picker on iPad and a macOS popup on desktop — both
 * in system typography, both ignoring the app's Ink & Seal palette. For
 * a reading app that lives in a quiet dark room, that hand-off is loud
 * and jarring.
 *
 * This primitive presents the same children-based API (`<option
 * value=…>label</option>`) so every existing call site keeps working
 * without edits, but renders its own popover: mono-cap selected state,
 * cinnabar stripe on the selected row, keyboard nav, click-outside and
 * Escape to close. No portals — the popover is absolute-positioned
 * relative to the trigger, which is fine for every surface in this app.
 *
 * Accessibility: the trigger is `role=combobox` with aria-expanded /
 * aria-controls; the list is `role=listbox`; each row is
 * `role=option` with aria-selected. Keyboard handling covers
 * ArrowUp/Down, Home, End, Enter, Space, Escape, Tab. Type-ahead
 * (pressing "r" jumps to the first option starting with "r") works
 * like the native element for familiarity.
 */

import {
  Children,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface OptionShape {
  value: string;
  label: ReactNode;
  /** When the label is a complex node, we still want text for type-ahead. */
  text: string;
  disabled?: boolean;
}

// Walk children (including <option>) into a flat option list. We also
// accept <optgroup> loosely — those will render as a disabled label
// followed by their nested options.
function childrenToOptions(children: ReactNode): OptionShape[] {
  const out: OptionShape[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as React.ReactElement<{
      value?: string | number;
      children?: ReactNode;
      disabled?: boolean;
      label?: string;
    }>;
    if (el.type === "option") {
      const value = String(el.props.value ?? "");
      const label = el.props.children ?? "";
      const text =
        typeof label === "string"
          ? label
          : typeof el.props.label === "string"
            ? el.props.label
            : String(label);
      out.push({
        value,
        label,
        text,
        disabled: el.props.disabled === true,
      });
    } else if (el.type === "optgroup") {
      const groupLabel = typeof el.props.label === "string" ? el.props.label : "";
      if (groupLabel) {
        out.push({
          value: `__group:${groupLabel}`,
          label: groupLabel,
          text: groupLabel,
          disabled: true,
        });
      }
      out.push(...childrenToOptions(el.props.children));
    }
  });
  return out;
}

interface SelectDropdownProps {
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  /** Alignment of the popover relative to the trigger. */
  align?: "start" | "end";
  /** Min width of the popover. Defaults to the trigger's own width. */
  menuMinWidth?: number;
}

export const SelectDropdown = forwardRef<HTMLSelectElement, SelectDropdownProps>(
  function SelectDropdown(
    {
      value,
      onChange,
      children,
      className,
      disabled,
      align = "start",
      menuMinWidth,
      ...props
    },
    forwardedRef,
  ) {
    const options = useMemo(() => childrenToOptions(children), [children]);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listboxRef = useRef<HTMLUListElement>(null);
    // Hidden native select that mirrors state — this is how we
    // preserve the existing `onChange(ChangeEvent<HTMLSelectElement>)`
    // API without forcing every call site to migrate.
    const nativeRef = useRef<HTMLSelectElement>(null);
    useImperativeHandle(forwardedRef, () => nativeRef.current as HTMLSelectElement);

    const selected = options.find((o) => o.value === value) ?? null;
    const firstEnabledIndex = options.findIndex((o) => !o.disabled);

    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState<number>(() => {
      const idx = options.findIndex((o) => o.value === value && !o.disabled);
      return idx >= 0 ? idx : firstEnabledIndex;
    });
    const listboxId = useId();

    // Keep activeIndex in sync when opening
    useEffect(() => {
      if (!open) return;
      const idx = options.findIndex((o) => o.value === value && !o.disabled);
      setActiveIndex(idx >= 0 ? idx : firstEnabledIndex);
    }, [open, options, value, firstEnabledIndex]);

    // Scroll the active option into view when navigating
    useEffect(() => {
      if (!open || !listboxRef.current) return;
      const node = listboxRef.current.querySelector<HTMLElement>(
        `[data-index="${activeIndex}"]`,
      );
      node?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, open]);

    // Focus the listbox when it opens so ArrowDown/Up/Enter/Escape
    // fire reliably. preventScroll stops the browser from dragging the
    // whole page when the popover would otherwise land below the fold.
    useEffect(() => {
      if (open) {
        const id = window.requestAnimationFrame(() => {
          listboxRef.current?.focus({ preventScroll: true });
        });
        return () => window.cancelAnimationFrame(id);
      }
    }, [open]);

    // Click outside to close
    useEffect(() => {
      if (!open) return;
      function handleClick(event: MouseEvent) {
        const target = event.target as Node;
        if (
          triggerRef.current?.contains(target) ||
          listboxRef.current?.contains(target)
        ) {
          return;
        }
        setOpen(false);
      }
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }, [open]);

    const commit = useCallback(
      (nextValue: string) => {
        if (nextValue === value) {
          setOpen(false);
          triggerRef.current?.focus({ preventScroll: true });
          return;
        }
        // Synthesise a native change event through the hidden select so
        // the caller's onChange signature stays intact.
        const native = nativeRef.current;
        if (native) {
          native.value = nextValue;
          const ev = new Event("change", { bubbles: true });
          native.dispatchEvent(ev);
        }
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      },
      [value],
    );

    // Type-ahead: pressing a letter jumps to next option starting with
    // that letter. Matches native <select> behaviour.
    const typeBufferRef = useRef<{ buffer: string; timer: number | null }>({
      buffer: "",
      timer: null,
    });
    const typeAhead = useCallback(
      (ch: string) => {
        const state = typeBufferRef.current;
        state.buffer += ch.toLowerCase();
        if (state.timer) window.clearTimeout(state.timer);
        state.timer = window.setTimeout(() => {
          state.buffer = "";
          state.timer = null;
        }, 600);

        const target = state.buffer;
        const startAt = activeIndex + (target.length === 1 ? 1 : 0);
        for (let offset = 0; offset < options.length; offset++) {
          const idx = (startAt + offset) % options.length;
          const opt = options[idx];
          if (opt.disabled) continue;
          if (opt.text.toLowerCase().startsWith(target)) {
            setActiveIndex(idx);
            return;
          }
        }
      },
      [activeIndex, options],
    );

    function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
      const { key } = event;
      if (key === "ArrowDown" || key === "ArrowUp" || key === " " || key === "Enter") {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (!open && key.length === 1 && /[\w\s]/.test(key)) {
        typeAhead(key);
        setOpen(true);
      }
    }

    function onListKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
      const { key } = event;
      if (key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
        return;
      }
      if (key === "Tab") {
        setOpen(false);
        return;
      }
      if (key === "ArrowDown") {
        event.preventDefault();
        for (let i = 1; i <= options.length; i++) {
          const next = (activeIndex + i) % options.length;
          if (!options[next].disabled) {
            setActiveIndex(next);
            break;
          }
        }
        return;
      }
      if (key === "ArrowUp") {
        event.preventDefault();
        for (let i = 1; i <= options.length; i++) {
          const next = (activeIndex - i + options.length) % options.length;
          if (!options[next].disabled) {
            setActiveIndex(next);
            break;
          }
        }
        return;
      }
      if (key === "Home") {
        event.preventDefault();
        const idx = options.findIndex((o) => !o.disabled);
        if (idx >= 0) setActiveIndex(idx);
        return;
      }
      if (key === "End") {
        event.preventDefault();
        for (let i = options.length - 1; i >= 0; i--) {
          if (!options[i].disabled) {
            setActiveIndex(i);
            break;
          }
        }
        return;
      }
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        const opt = options[activeIndex];
        if (opt && !opt.disabled) commit(opt.value);
        return;
      }
      if (key.length === 1 && /[\w\s]/.test(key)) {
        event.preventDefault();
        typeAhead(key);
      }
    }

    return (
      <div className="relative inline-block w-full">
        {/* Hidden native select — preserves the onChange signature and
            keeps the component form-compatible without shipping a
            parallel API. */}
        <select
          ref={nativeRef}
          value={value}
          onChange={onChange}
          disabled={disabled}
          aria-hidden
          tabIndex={-1}
          className="sr-only"
          {...props}
        >
          {children}
        </select>

        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-label={props["aria-label"]}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setOpen((v) => !v);
          }}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            "group flex w-full items-center justify-between gap-2 rounded-sm border border-border bg-surface-raised py-2 pl-3 pr-2 text-left text-sm text-text transition-colors duration-150",
            "hover:border-border hover:bg-surface-hover",
            "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30",
            open && "border-accent ring-1 ring-accent/30",
            disabled && "cursor-not-allowed opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-text-faint")}>
            {selected ? selected.label : "\u00a0"}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-text-faint transition-transform duration-150",
              open && "rotate-180 text-accent",
            )}
          />
        </button>

        {open && (
          <ul
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={
              activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
            }
            onKeyDown={onListKeyDown}
            style={menuMinWidth ? { minWidth: menuMinWidth } : undefined}
            className={cn(
              "absolute z-50 mt-1 max-h-60 min-w-full max-w-[calc(100vw-2rem)] overflow-auto rounded-sm border border-border bg-surface py-1 shadow-lg shadow-void/50 outline-none",
              align === "end" ? "right-0" : "left-0",
              // Just-enough reveal on open. Reduced-motion users get
              // it instantly per the global rule.
              "animate-[fade-up-in_120ms_ease-out]",
            )}
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isActive = idx === activeIndex;
              if (opt.disabled && opt.value.startsWith("__group:")) {
                return (
                  <li
                    key={`${opt.value}-${idx}`}
                    role="presentation"
                    className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint first:pt-1"
                  >
                    {opt.label}
                  </li>
                );
              }
              return (
                <li
                  key={`${opt.value}-${idx}`}
                  id={`${listboxId}-opt-${idx}`}
                  role="option"
                  data-index={idx}
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled}
                  onMouseEnter={() => !opt.disabled && setActiveIndex(idx)}
                  onMouseDown={(e) => {
                    // Prevent blur on the trigger when clicking an
                    // option — otherwise the outside-click handler
                    // fires before onClick.
                    e.preventDefault();
                  }}
                  onClick={() => {
                    if (opt.disabled) return;
                    commit(opt.value);
                  }}
                  className={cn(
                    "relative flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors",
                    opt.disabled
                      ? "cursor-default text-text-faint"
                      : isActive
                        ? "bg-surface-raised text-text"
                        : "text-text-muted",
                    isSelected && !opt.disabled && "text-accent",
                  )}
                >
                  {/* Left accent stripe on the selected row — mirrors
                      the sidebar "you are here" affordance. */}
                  {isSelected && !opt.disabled && (
                    <span
                      aria-hidden
                      className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-accent"
                    />
                  )}
                  <span className={cn("min-w-0 flex-1 truncate", isSelected && "font-medium")}>
                    {opt.label}
                  </span>
                  {isSelected && !opt.disabled && (
                    <Check className="h-3 w-3 shrink-0 text-accent" />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  },
);
