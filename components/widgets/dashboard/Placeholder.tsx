import React from "react";
import { WidgetItemProps } from "../Widget";

interface PlaceholderWidgetProps extends WidgetItemProps{
}

export default function PlaceholderWidget({ className = "" }: PlaceholderWidgetProps) {
  return (
    <div className={className}>
      Lorem, ipsum!
    </div>
  );
}
