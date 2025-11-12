import React from "react";

interface WidgetColumnTemplateProps {
  children: React.ReactNode;
  className?: string;
}

export default function WidgetColumnTemplate({ children, className = "" }: WidgetColumnTemplateProps) {
  return (
    <div className={`rounded-lg p-4 container-[type:inline-size] justify-center ${className}`}>
      <div
        className="grid auto-cols-fr grid-flow-col gap-2 text-center"
      >
            {children}
      </div>
    </div>
  );
}
