"use client";

import { cn } from "@/lib/utils";

interface WidgetCategoryFiltersProps {
  categories: string[];
  selectedCategory: string | null;
  onCategorySelect: (category: string | null) => void;
}

export default function WidgetCategoryFilters({
  categories,
  selectedCategory,
  onCategorySelect,
}: WidgetCategoryFiltersProps) {
  return (
    <div className="flex gap-2">
      <button
        onClick={() => onCategorySelect(null)}
        className={cn(
          "px-4 py-2 rounded-xl text-sm font-medium transition",
          selectedCategory === null
            ? "bg-white/20 backdrop-blur-md text-white border border-(--primary)"
            : "bg-white/10 text-gray-100 hover:bg-white/20"
        )}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => onCategorySelect(cat)}
          className={cn(
            "px-4 py-2 rounded-xl text-sm font-medium transition",
            selectedCategory === cat
              ? "bg-white/20 backdrop-blur-md text-white border border-(--primary)"
              : "bg-white/10 text-gray-100 hover:bg-white/20"
          )}
        >
          {cat.charAt(0).toUpperCase() + cat.slice(1)}
        </button>
      ))}
    </div>
  );
}