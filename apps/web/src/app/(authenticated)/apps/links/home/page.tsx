"use client";

import LinkView from "@/components/widgets/LinkView";

export default function LinksHomePage() {
    return (
        <div className="space-y-4">
            <header className="space-y-1">
                <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
                <p className="max-w-2xl text-sm text-white/60">
                    Edit the bookmarks that belong to your home list here. Links in the list tabs stay separate.
                </p>
            </header>

            <LinkView />
        </div>
    );
}