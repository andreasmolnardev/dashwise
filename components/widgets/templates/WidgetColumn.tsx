import React from "react";

interface WidgetColumnTemplateProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
}

export default function WidgetColumnTemplate({ children, className = "", title = "" }: WidgetColumnTemplateProps) {
  return (
    <div className={`rounded-lg px-4 py-2 justify-center ${className} flex-col`}>

      {title && (
        <h3 className="text-lg font-semibold mb-0.5">
          {title}
        </h3>
      )}
      <div
        className="grid auto-cols-fr grid-flow-col gap-2 text-center"
      >
        {children}
      </div>
    </div>
  );
}
