import React from "react";
import { WidgetItemProps } from "../Widget";

interface WeatherWidgetProps extends WidgetItemProps{
}

export default function WeatherWidget({ className = "" }: WeatherWidgetProps) {
  return (
    <div className={className}>
      Weather overview
    </div>
  );
}
