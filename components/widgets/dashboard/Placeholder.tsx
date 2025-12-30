import React from "react";
import { WidgetItemProps } from "../Widget";

interface PlaceholderWidgetProps extends WidgetItemProps{
}

export default function PlaceholderWidget({ className = "flex items-center justify-center" }: PlaceholderWidgetProps) {
  return (
    <div className={className}>
      This is a placeholder
    </div>
  );
}
