"use client";

import { useEffect, useState } from "react";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Label } from "@radix-ui/react-label";
import { Input } from "../ui/input";

interface Icon {
    Name: string;
    Reference: string;
    SVG: "Yes" | "No";
    PNG: "Yes" | "No";
    Light: "Yes" | "No";
    Dark: "Yes" | "No";
    Category: string;
    Tags?: string;
    CreatedAt?: string;
}

export default function IconPickerComponent({
    initialIcons = [],
    onClose,
    onSelect,
}: {
    initialIcons?: Icon[];
    onClose?: () => void;
    onSelect?: (icon: Icon) => void;
}) {
    const [icons, setIcons] = useState<Icon[]>(initialIcons);
    const [selected, setSelected] = useState<string | null>(null);
    const [search, setSearch] = useState("");

    // ✅ new: icon set mode
    const [iconSet, setIconSet] = useState<"default" | "mono">("default");

    useEffect(() => {
        fetch("/icons/index.json")
            .then((res) => res.json())
            .then((data: Icon[]) => setIcons(data))
            .catch(console.error);
    }, []);

    const getIconUrl = (icon: Icon) => {
        const ext = icon.SVG === "Yes" ? "svg" : "png";
        let variant = "";

        if (iconSet === "mono") {
            if (icon.Light === "Yes") variant = "light";
        }

        return `/icons/webp/${icon.Reference}${variant ? `-${variant}` : ""}.webp`;
    };

    const filteredIcons = icons.filter(
        (icon) =>
            icon.Name.toLowerCase().includes(search.toLowerCase()) ||
            icon.Category.toLowerCase().includes(search.toLowerCase())
    );

    const groupedIcons: Record<string, Icon[]> = filteredIcons.reduce(
        (acc, icon) => {
            const firstLetter = icon.Name[0].toUpperCase();
            if (!acc[firstLetter]) acc[firstLetter] = [];
            acc[firstLetter].push(icon);
            return acc;
        },
        {} as Record<string, Icon[]>
    );

    const handleSelect = (value: string) => {
        setSelected(value);
        const icon = icons.find((i) => i.Reference === value);
        if (onSelect && icon) onSelect(icon);
        if (onClose) onClose();
    };

    return (
        <div>
            <h3 className="text-lg font-semibold mb-2">Pick an icon</h3>

            <Input
                type="text"
                placeholder="Search icons..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="frosted w-full mb-2 p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />

            <div className="flex mb-2  rounded-md overflow-hidden w-fit frosted">
                {["default", "mono"].map((mode) => (
                    <button
                        key={mode}
                        onClick={() => setIconSet(mode as "default" | "mono")}
                        className={`
                        px-3 py-1 text-sm
                        ${iconSet === mode ? "bg-primary/20 border-primary" : "opacity-60"}
                        `}
                    >
                        {mode === "default" ? "Default" : "Monocolor"}
                    </button>
                ))}
            </div>

            <div className="max-h-[35vh] overflow-y-auto">
                {Object.keys(groupedIcons)
                    .sort()
                    .map((letter) => (
                        <div key={letter}>
                            <h4 className="font-semibold mt-2 mb-1">{letter}</h4>

                            <RadioGroup
                                value={selected ?? undefined}
                                onValueChange={handleSelect}
                                className="grid grid-cols-5 gap-4"
                            >
                                {groupedIcons[letter].map((icon) => (
                                    <Label
                                        key={icon.Reference}
                                        className={`h-[35px] w-[35px] rounded-md flex flex-col items-center justify-center cursor-pointer p-1 border bg-white/20 ${selected === icon.Reference
                                            ? "border-primary bg-primary/20"
                                            : "border-(--text-primary)/20"
                                            }`}
                                    >
                                        <RadioGroupItem
                                            value={icon.Reference}
                                            className="hidden"
                                        />

                                        <img
                                            src={getIconUrl(icon)}
                                            alt={icon.Name}
                                            loading="lazy"
                                            className="h-[20px] w-[20px]"
                                        />
                                    </Label>
                                ))}
                            </RadioGroup>
                        </div>
                    ))}
            </div>
        </div>
    );
}
