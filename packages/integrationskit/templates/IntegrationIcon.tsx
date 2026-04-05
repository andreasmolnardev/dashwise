"use client";

import { Icon } from "@iconify-icon/react";
import React, { use, useEffect, useRef, useState } from "react";

type IntegrationIconProps = {
	source?: string;
	alt?: string;
	size?: number;
	className?: string;
	fallbackPrefix?: string;
	useFrostedGradient?: boolean;
};

function isIconifySlug(source: string) {
	return source.includes(":") && !source.startsWith("http://") &&
		!source.startsWith("https://");
}

function resolveImageSource(source: string, fallbackPrefix: string) {
	if (
		source.startsWith("/") || source.startsWith("data:") ||
		source.startsWith("blob:")
	) {
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

	const isIconify = isIconifySlug(source);

	return isIconify
		? (
			<Icon
				icon={source}
				className={className + " opacity-70"}
				style={{
					maskImage: useFrostedGradient
						? `linear-gradient(130deg, black 60%, transparent)`
						: undefined,
					WebkitMaskImage: useFrostedGradient
						? `linear-gradient(130deg, black 60%, transparent)`
						: undefined,
				}}
				{...(size ? { width: size, height: size } : undefined)}
				aria-label={alt || undefined}
			/>
		)
		: (
			<img
				src={resolveImageSource(source, fallbackPrefix)}
				alt={alt}
				width={size}
				height={size}
				className={className}
			/>
		);
}
