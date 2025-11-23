import { faUpRightFromSquare } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { url } from "inspector";
import React from "react";

interface WidgetColumnTemplateProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  url?: string;
  iconUrl?: string;
}

export default function WidgetColumnTemplate({ children, className = "", title = "", url = "", iconUrl = "" }: WidgetColumnTemplateProps) {
  return (
    <div className={`rounded-lg p-2 justify-center ${className} flex-col`}>

        {(title || iconUrl) && (
        <a
          href={url || "#"}
          className="font-medium mb-1 grid grid-cols-[18px_1fr_16px] w-full text-start items-center gap-2.5"
        >
          {iconUrl && (
            <img src={iconUrl} className="h-4 mx-0.5" />
          )}

          <p className="font-semibold">{title}</p>

          {url && (
            <FontAwesomeIcon
              icon={faUpRightFromSquare}
              className="text-xs hover:text-(--primary)"
            />
          )}
        </a>
      )}
      <div
        className="grid auto-cols-fr grid-flow-col gap-2 text-center"
      >
        {children}
      </div>
    </div>
  );
}
