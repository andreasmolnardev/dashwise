"use client";

import * as React from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { Button } from "@/components/ui/button";

interface ColorPickerProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function ColorPicker({ value, onValueChange, className }: ColorPickerProps) {
  return (
    <div className={className}>
      {/* main picker */}
      <HexColorPicker color={value} onChange={onValueChange} style={{ width: "100%", height: "10rem" }} className="rounded-md" />

      {/* color input row */}
      <div className="flex items-center gap-2 mt-2">
        <HexColorInput
          color={value}
          onChange={onValueChange}
          prefixed
          className="flex-1 rounded-md border frosted px-2 py-1 text-sm"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onValueChange("#6b21a8")}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
