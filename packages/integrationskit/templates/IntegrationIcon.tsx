"use client";

import { Icon } from "@iconify-icon/react";
import React from "react";

type IntegrationIconProps = {
	source?: string;
	alt?: string;
	size?: number;
	className?: string;
	fallbackPrefix?: string;
	useFrostedGradient?: boolean;
};

function isIconifySlug(source: string) {
	return source.includes(":") && !source.startsWith("http://") && !source.startsWith("https://");
}

function resolveImageSource(source: string, fallbackPrefix: string) {
	if (source.startsWith("/") || source.startsWith("data:") || source.startsWith("blob:")) {
		return source;
	}

	return `${fallbackPrefix}${source}`;
}

export default function IntegrationIcon({
	source,
	alt = "",
	size,
	className,
	fallbackPrefix = "/weather-icons/",
	useFrostedGradient = false,
}: IntegrationIconProps) {
	if (!source) return null;

	const iconNode = isIconifySlug(source) ? (
		<Icon
			icon={source}
            className={className + " opacity-70"}
			{...size ? { width: size, height: size } : undefined}
			aria-label={alt || undefined}
		/>
	) : (
		<img
			src={resolveImageSource(source, fallbackPrefix)}
			alt={alt}
			width={size}
			height={size}
			className={className}
		/>
	);

	if (!useFrostedGradient) {
		return iconNode;
	}

	return (
  <span className="relative inline-flex items-center justify-center overflow-hidden rounded-sm">
    {iconNode}
    <span
      className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/40 via-white/10 to-transparent"
    />
  </span>
);

}