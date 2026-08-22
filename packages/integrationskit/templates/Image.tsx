"use client";

import React from "react";
import AppIcon from "@dashwise/app-icon";
import { Icon } from "@iconify-icon/react";
import type { ResolvedWidget } from "../types";
import { renderLocalizedText, type TextFormatters } from "../data/renderText";

interface ImageTemplateProps {
  resolved: ResolvedWidget;
  className?: string;
  formatters?: TextFormatters;
}

export default function ImageTemplate({
  resolved,
  className = "",
  formatters,
}: ImageTemplateProps) {
  const { header, image } = resolved;
  const configuredTitle = renderLocalizedText(header?.title ?? "", formatters);
  const title = header?.show !== false
    ? configuredTitle || imageFileName(image?.url ?? "")
    : "";
  const titleAction = header?.titleAction ?? "";
  const iconUrl = header?.icon ?? "";
  const hasTitle = Boolean(title || iconUrl);
  const altDescription = renderLocalizedText(image?.alt ?? "", formatters);
  const rawAltDescriptionMaxLines = Number(image?.altDescriptionMaxLines);
  const altDescriptionMaxLines = Number.isFinite(rawAltDescriptionMaxLines) &&
      rawAltDescriptionMaxLines >= 0
    ? Math.floor(rawAltDescriptionMaxLines)
    : 2;
  const altDescriptionStyle = altDescriptionMaxLines > 0
    ? {
      display: "-webkit-box",
      WebkitBoxOrient: "vertical" as const,
      WebkitLineClamp: altDescriptionMaxLines,
      overflow: "hidden",
    }
    : undefined;
  const imageContent = (
    <div
      className="w-full flex-1 min-h-0 flex items-center justify-center overflow-hidden rounded-lg bg-black/10"
      style={{
        minHeight: image?.minHeight ? `${image.minHeight}px` : undefined,
        maxHeight: image?.maxHeight ? `${image.maxHeight}px` : "none",
      }}
    >
      <img
        src={image?.url}
        alt={image?.alt ?? (typeof title === "string" ? title : "")}
        title={image?.showAltAsDescription
          ? image.action || undefined
          : image?.alt ?? (typeof title === "string" ? title : "")}
        className="block w-full max-w-full h-auto rounded-lg"
        style={{
          maxHeight: image?.maxHeight ? `${image.maxHeight}px` : "none",
          objectFit: image?.objectFit ?? "contain",
        }}
      />
    </div>
  );

  if (!image?.url) {
    return (
      <div className={`frosted rounded-xl p-4 flex items-center justify-center text-sm opacity-50 ${className}`}>
        No image URL provided
      </div>
    );
  }

  return (
    <div className={`frosted rounded-xl overflow-hidden flex flex-col gap-1 ${hasTitle ? "p-2" : ""} ${className}`}>
      {hasTitle && (
        <a
          href={titleAction || "#"}
          className="font-medium flex w-full text-start items-center gap-1 border-b border-white/5"
        >
          <AppIcon
            source={iconUrl}
            className={`h-4 w-4 ${iconUrl ? "" : "invisible"}`}
            alt=""
            size={16}
          />
          <p className="font-semibold truncate flex-1">{title}</p>
          {titleAction && (
            <Icon
              icon="fa6-solid:up-right-from-square"
              className="text-xs hover:text-primary transition-colors"
            />
          )}
        </a>
      )}
      {image.action ? (
        <a href={image.action} className="block w-full min-h-0">
          {imageContent}
        </a>
      ) : imageContent}
      {image.showAltAsDescription && image.alt && (
        <ClampedAltDescription
          text={image.alt}
          content={altDescription}
          maxLines={altDescriptionMaxLines}
          style={altDescriptionStyle}
        />
      )}
    </div>
  );
}

function ClampedAltDescription({
  text,
  content,
  maxLines,
  style,
}: {
  text: string;
  content: React.ReactNode;
  maxLines: number;
  style?: React.CSSProperties;
}) {
  const descriptionRef = React.useRef<HTMLParagraphElement>(null);
  const [hiddenTail, setHiddenTail] = React.useState("");

  React.useEffect(() => {
    const node = descriptionRef.current;
    if (!node || maxLines <= 0 || !text) {
      setHiddenTail("");
      return;
    }

    const updateHiddenTail = () => {
      const targetHeight = node.clientHeight;
      if (!targetHeight || !node.clientWidth) return;

      const measurement = node.cloneNode(false) as HTMLParagraphElement;
      measurement.textContent = "";
      measurement.style.position = "absolute";
      measurement.style.visibility = "hidden";
      measurement.style.pointerEvents = "none";
      measurement.style.display = "block";
      measurement.style.width = `${node.clientWidth}px`;
      measurement.style.height = "auto";
      measurement.style.maxHeight = "none";
      measurement.style.overflow = "visible";
      measurement.style.webkitLineClamp = "unset";
      document.body.appendChild(measurement);

      const fits = (value: string) => {
        measurement.textContent = value;
        return measurement.scrollHeight <= targetHeight + 1;
      };

      try {
        if (fits(text)) {
          setHiddenTail("");
          return;
        }

        let low = 0;
        let high = text.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (fits(text.slice(0, middle))) low = middle;
          else high = middle - 1;
        }

        const tail = text.slice(low).trimStart();
        setHiddenTail(tail ? `... ${tail}` : "");
      } finally {
        measurement.remove();
      }
    };

    updateHiddenTail();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateHiddenTail);
    observer.observe(node);
    return () => observer.disconnect();
  }, [maxLines, text]);

  return (
    <p
      ref={descriptionRef}
      className="px-1 text-sm text-white/70"
      title={hiddenTail || undefined}
      style={style}
    >
      {content}
    </p>
  );
}

function imageFileName(value: string) {
  if (!value) return "";
  const withoutQuery = value.split(/[?#]/, 1)[0];
  const segment = withoutQuery.split("/").filter(Boolean).pop() ?? "";
  if (!segment || segment.includes(":")) return "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
