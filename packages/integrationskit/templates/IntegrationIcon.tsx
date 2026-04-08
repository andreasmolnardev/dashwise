"use client";

import AppIcon, { type AppIconProps } from "./AppIcon";

export type IntegrationIconProps = AppIconProps;

export default function IntegrationIcon({
	alt = "",
	fallbackPrefix = "/weather-icons/",
	iconClassName = "opacity-70",
	...props
}: IntegrationIconProps) {
	return (
		<AppIcon
			{...props}
			alt={alt}
			fallbackPrefix={fallbackPrefix}
			iconClassName={iconClassName}
		/>
	);
}
