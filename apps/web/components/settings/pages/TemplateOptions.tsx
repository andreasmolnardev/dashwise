"use client";

import { TemplateId, TEMPLATE_OPTIONS } from "./utils";

type TemplateOptionsProps = {
  template: TemplateId;
  onTemplateChange: (template: TemplateId) => void;
};

export function TemplateOptions({ template, onTemplateChange }: TemplateOptionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-medium">Layout</p>
      <div className="flex items-center gap-2">
        {TEMPLATE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onTemplateChange(option.id)}
            className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
              template === option.id
                ? "border-white/80 bg-white/20"
                : "border-white/20"
            }`}
          >
            <div className="mb-2 flex h-10 w-20 rounded border border-white/40 p-1">
              {option.id === "main" ? (
                <>
                  <span className="h-full w-1/4 rounded-sm border border-white/40" />
                  <span className="mx-1 h-full flex-1 rounded-sm border border-white/40" />
                  <span className="h-full w-1/4 rounded-sm border border-white/40" />
                </>
              ) : (
                <>
                  <span className="h-full w-1/4 rounded-sm border border-white/40" />
                  <span className="ml-1 h-full flex-1 rounded-sm border border-white/40" />
                </>
              )}
            </div>
            <p>{option.label.toLowerCase()}</p>
          </button>
        ))}
      </div>
    </div>
  );
}