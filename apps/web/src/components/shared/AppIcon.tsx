"use client";

import React, { useState } from "react";
import { Icon as IconifyIcon } from "@iconify-icon/react";

const ICONIFY_API_PREFIX = "https://api.iconify.design/";

export function isIconifySource(source?: string | null) {
    return Boolean(source && (
        source.startsWith(ICONIFY_API_PREFIX)
        || source.startsWith("url:")
        || (source.includes(":") && !source.startsWith("http://") && !source.startsWith("https://"))
    ));
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

    if (source.startsWith("url:")) {
        return null;
    }

    return isIconifySource(source) ? source : null;
}

function isMonoIconSource(source?: string | null) {
    if (!source) return false;

    return /^\/icons\/(?:webp|png|svg)\/[^/]+?-(?:light|dark)\.(?:webp|png|svg)(?:\?.*)?$/i.test(source);
}

export default function AppIcon({
    source,
    alt,
    className,
    imageClassName,
    fallbackSource,
}: {
    source?: string | null;
    alt?: string;
    className?: string;
    imageClassName?: string;
    fallbackSource?: string | null;
}) {
    if (!source) return null;

    if (source.startsWith("url:")) {
        const imageSource = source.slice(4).trim();
        if (!imageSource) {
            return fallbackSource ? (
                <AppIcon
                    source={fallbackSource}
                    alt={alt}
                    className={className}
                    imageClassName={imageClassName}
                />
            ) : null;
        }

        return <UrlImageIcon source={imageSource} alt={alt} className={className} imageClassName={imageClassName} fallbackSource={fallbackSource} />;
    }

    const iconifySlug = getIconifySlugFromSource(source);
    if (iconifySlug) {
        return (
            <IconifyIcon
                icon={iconifySlug}
                className={className}
                aria-label={alt || undefined}
            />
        );
    }

    if (isMonoIconSource(source)) {
        return (
            <span
                className={`bg-current ${className ?? ""}`.trim()}
                style={{
                    maskImage: `url(${source})`,
                    WebkitMaskImage: `url(${source})`,
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskPosition: "center",
                    WebkitMaskPosition: "center",
                    maskSize: "contain",
                    WebkitMaskSize: "contain",
                }}
                aria-hidden
            />
        );
    }

    return (
        <img
            src={source}
            alt={alt ?? ""}
            className={`${className ?? ""} ${imageClassName ?? ""}`.trim()}
        />
    );
}

function UrlImageIcon({
    source,
    alt,
    className,
    imageClassName,
    fallbackSource,
}: {
    source: string;
    alt?: string;
    className?: string;
    imageClassName?: string;
    fallbackSource?: string | null;
}) {
    const [failed, setFailed] = useState(false);

    if (failed && fallbackSource && fallbackSource !== `url:${source}`) {
        return (
            <AppIcon
                source={fallbackSource}
                alt={alt}
                className={className}
                imageClassName={imageClassName}
            />
        );
    }

    return (
        <img
            src={source}
            alt={alt ?? ""}
            onError={() => setFailed(true)}
            className={`${className ?? ""} ${imageClassName ?? ""}`.trim()}
        />
    );
}