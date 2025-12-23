"use client";

import React, { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabItem = {
  value: string;
  label: string;
};

type TabSwitcherProps = {
  value: string;
  onValueChange: (value: string) => void;
  items?: TabItem[];
  children?: ReactNode;
  className?: string;
  listClassName?: string;
};

/**
 * Reusable Tab Switcher component with animation
 * Similar to the glanceables left/right switcher
 * Supports both items array and children for flexibility
 */
export default function TabSwitcher({
  value,
  onValueChange,
  items,
  children,
  className = "",
  listClassName = "",
}: TabSwitcherProps) {
  return (
    <Tabs
      value={value}
      onValueChange={onValueChange}
      className={`w-full flex items-center my-4 ${className}`}
    >
      <TabsList className={`frosted rounded-full gap-2 text-white/20 ${listClassName}`}>
        {items ? (
          items.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="data-[state=active]:bg-white/20 rounded-full transition-all duration-300 ease-out"
            >
              <span className="text-(--text-primary)">{item.label}</span>
            </TabsTrigger>
          ))
        ) : (
          children
        )}
      </TabsList>
    </Tabs>
  );
}
