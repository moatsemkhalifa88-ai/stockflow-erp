import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  label: string;
  options: SelectOption[];
  /** Adds a first option with an empty value, e.g. "All warehouses" or "Choose…". */
  placeholder?: string;
  error?: string;
  hint?: string;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
}

export function SelectField({
  id,
  label,
  options,
  placeholder,
  error,
  hint,
  hideLabel = false,
  className,
  ...selectProps
}: SelectFieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={cn("block text-sm font-medium text-slate-700", hideLabel && "sr-only")}>
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "block h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 shadow-sm",
          "focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none",
          error ? "border-red-400" : "border-slate-300",
          className,
        )}
        {...selectProps}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
