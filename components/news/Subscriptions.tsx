"use client";

import { useState, useRef, useEffect } from "react";
import { faPlus, faCheck, faXmark, faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

// --------------------
// Types
// --------------------
export interface Feed {
    id: number;
    icon: string; // URL to favicon or custom
    name: string;
    url: string;
}

export interface FeedsByCategory {
    [category: string]: Feed[];
}

// --------------------
// Small helper component
// --------------------
const ImageWithFallback = ({ src, alt, size = 28 }: { src: string; alt: string; size?: number }) => {
    const [ok, setOk] = useState(true);

    return (
        <div className="flex items-center justify-center" style={{ width: size, height: size }}>
            {ok ? (
                <img
                    src={src}
                    alt={alt}
                    width={size}
                    height={size}
                    className="rounded"
                    onError={() => setOk(false)}
                />
            ) : (
                <span className="rounded bg-gray-200 text-gray-700 flex items-center justify-center text-sm font-medium"
                    style={{ width: size, height: size }}>
                    {alt?.[0]?.toUpperCase() ?? "F"}
                </span>
            )}
        </div>
    );
};

// --------------------
// Mock data
// --------------------
const initialCategories: string[] = [
    "Technology", "Finance", "Science", "Sports", "Lifestyle", "Gaming", "Politics"
];

const initialFeedsByCategory: FeedsByCategory = {
    Technology: [
        { id: 1, icon: "https://techcrunch.com/favicon.ico", name: "TechCrunch", url: "https://techcrunch.com/feed" },
        { id: 2, icon: "https://www.theverge.com/apple-touch-icon.png", name: "The Verge", url: "https://www.theverge.com/rss/index.xml" }
    ],
    Finance: [
        { id: 3, icon: "https://www.bloomberg.com/favicon.ico", name: "Bloomberg", url: "https://www.bloomberg.com/feeds/bna/latest.rss" }
    ],
    Science: [
        { id: 4, icon: "https://www.nature.com/favicon.ico", name: "Nature News", url: "https://www.nature.com/latest-news.rss" }
    ],
    Sports: [],
    Lifestyle: [],
    Gaming: [],
    Politics: []
};

// --------------------
// Grid column layout
// --------------------
const FEED_GRID_COLS = "grid-cols-[50px_1.5fr_2fr_100px]";

// --------------------
// New Feed Row
// --------------------
interface NewFeedRowProps {
    category: string;
    onConfirm: (feed: Omit<Feed, "id"> & { category: string }) => void;
    onCancel: () => void;
}

const NewFeedGridRow = ({ category, onConfirm, onCancel }: NewFeedRowProps) => {
    const [icon, setIcon] = useState("");
    const [name, setName] = useState("");
    const [url, setUrl] = useState("");

    // Autofill favicon
    useEffect(() => {
        if (!url) return;
        if (icon) return;

        try {
            const origin = new URL(url).origin;
            setIcon(`${origin}/favicon.ico`);
        } catch {
            /* ignore invalid URLs */
        }
    }, [url, icon]);

    const handleConfirm = () => {
        if (!name || !url) {
            alert("Name and URL are required.");
            return;
        }

        let finalIcon = icon;

        if (!finalIcon) {
            try {
                finalIcon = `${new URL(url).origin}/favicon.ico`;
            } catch {
                finalIcon = "";
            }
        }

        onConfirm({
            category,
            icon: finalIcon,
            name,
            url
        });
    };

    return (
        <div className={`grid ${FEED_GRID_COLS} items-center`}>
            <div className="p-2 border-r border-[color:var(--primary)]/10">
                <input
                    type="url"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    placeholder="Icon URL (favicon)"
                    className="w-full bg-transparent text-sm focus:outline-none"
                />
            </div>

            <div className="p-2 border-r border-[color:var(--primary)]/10">
                <input
                    type="text"
                    placeholder="Feed Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-transparent focus:outline-none"
                />
            </div>

            <div className="p-2 border-r border-[color:var(--primary)]/10">
                <input
                    type="url"
                    placeholder="Feed URL"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="w-full bg-transparent text-sm focus:outline-none"
                />
            </div>

            <div className="p-2 flex justify-center space-x-2">
                <button onClick={handleConfirm} className="p-1 hover:text-(--primary)">
                    <FontAwesomeIcon icon={faCheck} />
                </button>
                <button onClick={onCancel} className="p-1 hover:text-(--primary)">
                    <FontAwesomeIcon icon={faXmark} />
                </button>
            </div>
        </div>
    );
};

// --------------------
// New Category Row
// --------------------
interface NewCategoryProps {
    onConfirm: (name: string) => void;
    onCancel: () => void;
}

const NewCategoryRow = ({ onConfirm, onCancel }: NewCategoryProps) => {
    const [value, setValue] = useState("");

    return (
        <div className="flex items-center space-x-2 p-2 rounded-md border border-[color:var(--primary)]/10 bg-[color:var(--primary)]/6">
            <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="New category name"
                className="flex-1 bg-transparent focus:outline-none"
            />
            <button onClick={() => value.trim() && onConfirm(value.trim())} className="text-[color:var(--primary)] p-1">
                <FontAwesomeIcon icon={faCheck} />
            </button>
            <button onClick={onCancel} className="text-red-600 p-1">
                <FontAwesomeIcon icon={faXmark} />
            </button>
        </div>
    );
};

// --------------------
// Main Component
// --------------------
export default function NewsSubscriptionsOverview() {
    const [categories, setCategories] = useState<string[]>(initialCategories);
    const [selectedCategory, setSelectedCategory] = useState<string>(categories[0]);
    const [isAddingCategory, setIsAddingCategory] = useState(false);

    const [feedsData, setFeedsData] = useState<FeedsByCategory>(initialFeedsByCategory);
    const [isAddingNewFeed, setIsAddingNewFeed] = useState(false);

    const feeds = feedsData[selectedCategory] || [];

    const activeBgRef = useRef<HTMLDivElement>(null);
    const categoryContainerRef = useRef<HTMLDivElement>(null);

    // Position active category highlight
    useEffect(() => {
        const container = categoryContainerRef.current;
        const activeEl = container?.querySelector<HTMLDivElement>(
            `.category-label-div[data-category="${selectedCategory}"]`
        );

        if (activeEl && activeBgRef.current && container) {
            const elRect = activeEl.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const topPosition = elRect.top - containerRect.top + container.scrollTop;

            activeBgRef.current.style.top = `${topPosition}px`;
            activeBgRef.current.style.height = `${elRect.height}px`;
        }
    }, [selectedCategory, categories]);

    const handleAddFeedConfirm = (newFeed: Omit<Feed, "id"> & { category: string }) => {
        const updated = [...(feedsData[newFeed.category] ?? []), { ...newFeed, id: Date.now() }];
        setFeedsData((prev) => ({ ...prev, [newFeed.category]: updated }));
        setIsAddingNewFeed(false);
    };

    const handleNewCategoryConfirm = (name: string) => {
        if (!name) return;
        if (categories.includes(name)) return alert("Category already exists");

        setCategories((prev) => [...prev, name]);
        setFeedsData((prev) => ({ ...prev, [name]: [] }));
        setSelectedCategory(name);
        setIsAddingCategory(false);
    };

    return (
        <div className="grid grid-cols-[300px_1fr] gap-4 p-4 min-h-[400px]">
            <h1 className="col-span-full text-3xl font-bold">Manage your subscriptions</h1>

            {/* Left: Categories */}
            <div className="w-full">
                <div ref={categoryContainerRef} className="relative flex flex-col py-1 pr-4 overflow-auto max-h-[520px]">
                    <div className="space-y-1">

                        <div
                            ref={activeBgRef}
                            className="absolute left-0 w-[95%] rounded-md transition-all duration-200 bg-white/20"
                            style={{ zIndex: 0 }}
                        />

                        {categories.map((category) => (
                            <div key={category} className="group cursor-pointer" onClick={() => setSelectedCategory(category)}>
                                <div
                                    className="p-2 rounded-md relative category-label-div text-white font-medium"
                                    data-category={category}
                                    style={{ zIndex: 1 }}
                                >
                                    {category}
                                </div>
                            </div>
                        ))}

                        {isAddingCategory ? (
                            <NewCategoryRow onConfirm={handleNewCategoryConfirm} onCancel={() => setIsAddingCategory(false)} />
                        ) : (
                            <div className="cursor-pointer" onClick={() => setIsAddingCategory(true)}>
                                <div className="p-2 rounded-md hover:bg-white/20 text-sm">+ Add category</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Right: Feeds */}
            <div className="py-1">
                <h2 className="text-xl font-bold mb-4">
                    Feeds in <span className="text-[var(--primary)]">{selectedCategory}</span>
                </h2>

                <div className="overflow-hidden">
                    
                    {/* Header */}
                    <div className={`grid ${FEED_GRID_COLS} font-semibold`}>
                        <div className="p-2 text-center">Icon</div>
                        <div className="p-2">Name</div>
                        <div className="p-2">URL</div>
                        <div className="p-2 text-center">Action</div>
                    </div>

                    {/* Feeds list */}
                    <div className="divide-y divide-gray-200">
                        {feeds.map((feed) => (
                            <div key={feed.id} className={`grid ${FEED_GRID_COLS} items-center rounded-md hover:bg-white/20 border-0`}>
                                <div className="p-2 flex justify-center">
                                    <ImageWithFallback src={feed.icon} alt={feed.name} size={28} />
                                </div>

                                <div className="p-2">{feed.name}</div>

                                <div className="p-2">
                                    <a href={feed.url} target="_blank" rel="noopener noreferrer"
                                        className="text-sm text-(--text-primary) hover:underline block truncate">
                                        {feed.url}
                                    </a>
                                </div>

                                <div className="p-2 text-center">
                                    <button className="hover:text-red-500">
                                        <FontAwesomeIcon icon={faTrash} />
                                    </button>
                                </div>
                            </div>
                        ))}

                        {/* New feed row */}
                        {isAddingNewFeed && (
                            <NewFeedGridRow
                                category={selectedCategory}
                                onConfirm={handleAddFeedConfirm}
                                onCancel={() => setIsAddingNewFeed(false)}
                            />
                        )}

                        {/* Add new button */}
                        {!isAddingNewFeed && (
                            <button
                                onClick={() => setIsAddingNewFeed(true)}
                                className="w-full py-2 text-[--text-primary] font-semibold flex items-center justify-center space-x-2 hover:bg-white/20 rounded-md"
                            >
                                <FontAwesomeIcon icon={faPlus} />
                                <span>Add New Feed</span>
                            </button>
                        )}

                        {feeds.length === 0 && !isAddingNewFeed && (
                            <div className="p-4 text-center italic text-white">
                                No feeds found for this category.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
