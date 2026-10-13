"use client";
import { useEffect } from "react";
import { useTranslations } from "next-intl";

export function LocalizedValidation() {
  const t = useTranslations("validation");
  useEffect(() => {
    const owned = new WeakMap<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
      string
    >();
    const control = (target: EventTarget | null) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
        ? target
        : null;
    const clearField = (field: ReturnType<typeof control>) => {
      if (field && owned.has(field)) {
        if (field.validationMessage === owned.get(field))
          field.setCustomValidity("");
        owned.delete(field);
      }
    };
    const clear = (event: Event) => clearField(control(event.target));
    const reset = (event: Event) => {
      if (event.target instanceof HTMLFormElement)
        for (const field of event.target.elements) clearField(control(field));
    };
    const invalid = (event: Event) => {
      const field = control(event.target);
      if (!field) return;
      clear(event);
      const validity = field.validity;
      if (validity.customError || validity.valid) return;
      const key = validity.valueMissing
        ? "required"
        : validity.typeMismatch
          ? "type"
          : validity.tooLong || validity.tooShort
            ? "length"
            : validity.rangeOverflow || validity.rangeUnderflow
              ? "range"
              : "invalid";
      const message = t(key);
      field.setCustomValidity(message);
      owned.set(field, message);
    };
    document.addEventListener("invalid", invalid, true);
    document.addEventListener("input", clear, true);
    document.addEventListener("change", clear, true);
    document.addEventListener("reset", reset, true);
    return () => {
      document.removeEventListener("invalid", invalid, true);
      document.removeEventListener("input", clear, true);
      document.removeEventListener("change", clear, true);
      document.removeEventListener("reset", reset, true);
      for (const field of document.querySelectorAll("input,textarea,select"))
        clearField(control(field));
    };
  }, [t]);
  return null;
}
