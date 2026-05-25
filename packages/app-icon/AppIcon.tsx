"use client";

import { Icon as IconifyIcon } from "@iconify-icon/react";
import { useState } from "react";

const ICONIFY_API_PREFIX = "https://api.iconify.design/";

export type AppIconProps = {
	source?: string | null;
	alt?: string;
	size?: number;
	className?: string;
	monoClassName?: string;
	imageClassName?: string;
	fallbackSource?: string | null;
	fallbackPrefix?: string;
	useFrostedGradient?: boolean;
	iconClassName?: string;
};


export default function AppIcon({
	source,
	alt,
	size,
	className,
	monoClassName,
	imageClassName,
	fallbackSource,
	fallbackPrefix = "",
	useFrostedGradient = false,
	iconClassName,
}: AppIconProps) {
	if (!source) return null;

	// normalize url:
	const normalized =
		source.startsWith("url:") ? source.slice(4).trim() : source;

	// Iconify
	const iconifySlug = getIconifySlugFromSource(source);
	if (iconifySlug) {
		return (
			<IconifyIcon
				icon={iconifySlug}
				className={combineClassNames(className, iconClassName)}
				style={{
					maskImage: useFrostedGradient
						? "linear-gradient(130deg, black 60%, transparent)"
						: undefined,
					WebkitMaskImage: useFrostedGradient
						? "linear-gradient(130deg, black 60%, transparent)"
						: undefined,
				}}
				{...(size ? { width: size, height: size } : undefined)}
				aria-label={alt || undefined}
			/>
		);
	}

	// Mono icon
	if (isMonoIconSource(normalized)) {
		return (
			<MaskedIcon
				source={normalized}
				size={size}
				className={combineClassNames(className, monoClassName)}
			/>
		);
	}

	// URL image
	if (source.startsWith("url:")) {
		const imageSource = normalized;

		if (!imageSource) {
			return fallbackSource ? (
				<AppIcon
					source={fallbackSource}
					alt={alt}
					className={className}
					imageClassName={imageClassName}
					fallbackPrefix={fallbackPrefix}
					size={size}
				/>
			) : null;
		}

		if (isMonoIconSource(imageSource)) {
			return (
				<MaskedIcon
					source={imageSource}
					size={size}
					className={combineClassNames(className, monoClassName)}
				/>
			);
		}

		return (
			<UrlImageIcon
				source={imageSource}
				alt={alt}
				className={className}
				imageClassName={imageClassName}
				fallbackSource={fallbackSource}
				size={size}
			/>
		);
	}

	// Fallback image
	return (
		<img
			src={resolveUrlSource(source, fallbackPrefix)}
			alt={alt ?? ""}
			width={size}
			height={size}
			className={combineClassNames(className, imageClassName)}
		/>
	);
}

function combineClassNames(...classNames: Array<string | undefined | null>) {
	return classNames.filter(Boolean).join(" ");
}

export function isIconifySource(source?: string | null) {
	return Boolean(
		source &&
			(source.startsWith(ICONIFY_API_PREFIX) ||
				source.startsWith("url:") ||
				(source.includes(":") &&
					!source.startsWith("http://") &&
					!source.startsWith("https://")))
	);
}

export function getIconifySlugFromSource(source?: string | null) {
	if (!source) return null;

	if (source.startsWith(ICONIFY_API_PREFIX)) {
		try {
			const parsed = new URL(source);
			return parsed.pathname.replace(/^\//, "").replace(/\.svg$/, "");
		} catch {
			return null;
		}
	}

	if (source.startsWith("url:")) return null;

	return isIconifySource(source) ? source : null;
}

export function isMonoIconSource(source?: string | null) {
	if (!source) return false;

	return /^\/icons\/(?:webp|png|svg)\/[^/]+?-(?:light|dark)\.(?:webp|png|svg)(?:\?.*)?$/i.test(
		source
	);
}

function resolveUrlSource(source: string, fallbackPrefix: string) {
	if (
		source.startsWith("/") ||
		source.startsWith("data:") ||
		source.startsWith("blob:") ||
		source.startsWith("http://") ||
		source.startsWith("https://")
	) {
		return source;
	}

	return fallbackPrefix ? `${fallbackPrefix}${source}` : source;
}

function MaskedIcon({
	source,
	size,
	className,
}: {
	source: string;
	size?: number;
	className?: string;
}) {
	return (
		<span
			className={combineClassNames(
				"bg-current inline-block shrink-0",
				className
			)}
			style={{
				maskImage: `url('${source}')`,
				WebkitMaskImage: `url('${source}')`,
				maskRepeat: "no-repeat",
				WebkitMaskRepeat: "no-repeat",
				maskPosition: "center",
				WebkitMaskPosition: "center",
				maskSize: "contain",
				WebkitMaskSize: "contain",
				...(size ? { width: size, height: size } : {}),
			}}
		/>
	);
}

function UrlImageIcon({
	source,
	alt,
	className,
	imageClassName,
	fallbackSource,
	size,
}: {
	source: string;
	alt?: string;
	className?: string;
	imageClassName?: string;
	fallbackSource?: string | null;
	size?: number;
}) {
	const [failed, setFailed] = useState(false);

	if (failed && fallbackSource && fallbackSource !== `url:${source}`) {
		return (
			<AppIcon
				source={fallbackSource}
				alt={alt}
				className={className}
				imageClassName={imageClassName}
				size={size}
			/>
		);
	}

	return (
		<img
			src={source}
			alt={alt ?? ""}
			onError={() => setFailed(true)}
			width={size}
			height={size}
			className={combineClassNames(className, imageClassName)}
		/>
	);
}
