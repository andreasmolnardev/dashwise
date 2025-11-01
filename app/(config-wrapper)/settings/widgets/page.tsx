"use client";
import { useState } from "react";
import widgetsData from "@/public/widgets.json";
import WidgetComponent from "@/components/widgets/Widget";

export default function WidgetsSettingsPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const displayedWidgets = selectedCategory
    ? widgetsData[selectedCategory]
    : Object.values(widgetsData).flat();

  const categories = Object.keys(widgetsData); // ["calendar", "placeholders", "weather"]

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold mb-4">Widgets</h1>
      <p>To add them to your dashboard, drag and drop them onto a section</p>

      <div className="grid grid-rows-[1fr] aspect-video overflow-hidden bg-(--surface) rounded-lg frosted light">
        <main className="grid grid-cols-[25%_1fr_25%] p-2 gap-2 ">
          <div className="border-white/20 border-1 rounded-md h-full"></div>

          <div className="space-y-2">
            <section className="grid grid-cols-[1fr_auto_1fr] items-center justify-items-center gap-2">
              <div className="frosted w-18 h-4 rounded-md"></div>
              <div className="frosted w-24 h-12 rounded-md"></div>
              <div className="frosted w-18 h-4 rounded-md"></div>
            </section>

            <div className="frosted h-6 rounded-lg flex items-center justify-center text-xs">Search</div>
            <div className="frosted h-26 rounded-md flex items-center justify-center text-xs">Links</div>
            <div className="border-white/20 border-1 rounded-md h-26"></div>
          </div>

          <div className="border-white/20 border-1 rounded-md h-full"></div>
        </main>
      </div>

       {/* Filter buttons */}
      <div className="flex gap-2 mb-4">
        <button
          className={`px-3 py-1 rounded-md ${
            selectedCategory === null ? "bg-blue-500 text-white" : "bg-gray-200"
          }`}
          onClick={() => setSelectedCategory(null)}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            className={`px-3 py-1 rounded-md ${
              selectedCategory === cat ? "bg-blue-500 text-white" : "bg-gray-200"
            }`}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      <ul
        className="grid gap-4 overflow-y-hidden overflow-x-scroll"
        style={{
          gridTemplateColumns: `repeat(${displayedWidgets.length}, 220px)`,
          gridTemplateRows: `90px`,
        }}
      >
        {displayedWidgets.map((widget) => (
          <WidgetComponent type={widget.slug} key={widget.slug} />
        ))}
      </ul>
    </section>
  );
}
