"use client";

import React from "react";
import { Icon as IconifyIcon } from "@iconify-icon/react";

const ICONIFY_API_PREFIX = "https://api.iconify.design/";

export function isIconifySource(source?: string | null) {
    return Boolean(source && (
        source.startsWith(ICONIFY_API_PREFIX)
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
}: {
    source?: string | null;
    alt?: string;
    className?: string;
    imageClassName?: string;
}) {
    if (!source) return null;

    console.log("Rendering AppIcon with source:", source, className);

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