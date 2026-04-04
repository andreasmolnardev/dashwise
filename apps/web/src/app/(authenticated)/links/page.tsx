"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify-icon/react";
import { Link, useNavigate } from "react-router-dom";
import useAuth from "@/context/useAuth";
import { getHomeLinksAction } from "@/app/actions/links";
import TwoColumnPageShell from "@/components/pages/TwoColumnPageShell";

type LinkItem = {
  id?: string;
  name?: string;
  title?: string;
  url?: string;
  icon?: string;
  iconUrl?: string;
  collection?: string;
  linkGroup?: string;
  folder?: string;
};

function safeHost(url?: string) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function LinksPage() {
  const navigate = useNavigate();
  const { token, withAuth } = useAuth();
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [activeCollection, setActiveCollection] = useState<string>("All");

  useEffect(() => {
    if (!token) {
      navigate("/auth/login");
    }
  }, [navigate, token]);

  useEffect(() => {
    let mounted = true;

    const loadLinks = async () => {
      if (!token) return;

      try {
        const data = await withAuth((auth) => getHomeLinksAction(auth));
        if (mounted && Array.isArray(data)) {
          setLinks(data as LinkItem[]);
        }
      } catch (err) {
        console.error("Failed to load links:", err);
      }
    };

    void loadLinks();

    return () => {
      mounted = false;
    };
  }, [token, withAuth]);

  const collections = useMemo(
    () => Array.from(new Set(links.map((link) => link.collection ?? link.linkGroup ?? "").filter(Boolean))).sort(),
    [links],
  );

  useEffect(() => {
    if (activeCollection !== "All" && !collections.includes(activeCollection)) {
      setActiveCollection("All");
    }
  }, [activeCollection, collections]);

  const visibleLinks = useMemo(() => {
    if (activeCollection === "All") return links;
    return links.filter((link) => (link.collection ?? link.linkGroup ?? "") === activeCollection);
  }, [activeCollection, links]);

  return (
    <TwoColumnPageShell
      subtitle="Library"
      title="Links"
      leftContent={
        <div className="space-y-5">
          <p className="text-sm leading-relaxed opacity-75">
            A dedicated view for your saved links, grouped and filtered without leaving the page.
          </p>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setActiveCollection("All")}
              className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                activeCollection === "All"
                  ? "border-white/70 bg-white/15 font-semibold"
                  : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
              }`}
            >
              All links
            </button>

            {collections.map((collection) => (
              <button
                key={collection}
                type="button"
                onClick={() => setActiveCollection(collection)}
                className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition capitalize ${
                  activeCollection === collection
                    ? "border-white/70 bg-white/15 font-semibold"
                    : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
                }`}
              >
                {collection}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/10 p-4 text-sm opacity-80">
            <p className="font-semibold">{visibleLinks.length} links</p>
            <p className="mt-1">Use this page as a launchpad for saved destinations and link groups.</p>
          </div>
        </div>
      }
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.35em] opacity-60">Saved links</p>
          <h2 className="text-xl font-semibold">{activeCollection === "All" ? "All collections" : activeCollection}</h2>
        </div>
        <Link
          to="/settings/general"
          className="frosted rounded-full px-4 py-2 text-sm transition-colors hover:text-(--primary)"
        >
          Manage links
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibleLinks.map((link) => {
          const label = link.title ?? link.name ?? "Untitled link";
          const iconSrc = link.iconUrl ?? link.icon ?? "";
          const collection = link.collection ?? link.linkGroup ?? "";

          return (
            <a
              key={link.id ?? `${label}-${link.url ?? collection}`}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex min-h-32 flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:-translate-y-0.5 hover:bg-white/10"
            >
              <div className="flex items-start justify-between gap-3">
                {iconSrc ? (
                  <img src={iconSrc} alt={label} className="h-8 w-8 rounded-lg object-contain" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
                    <Icon icon="fa6-solid:link" className="h-4 w-4 opacity-70" />
                  </div>
                )}

                {collection ? (
                  <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.25em] opacity-70">
                    {collection}
                  </span>
                ) : null}
              </div>

              <div className="space-y-1">
                <p className="text-base font-semibold leading-tight">{label}</p>
                <p className="text-xs opacity-65">{safeHost(link.url)}</p>
              </div>
            </a>
          );
        })}

        {visibleLinks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-6 text-sm opacity-70">
            No links found in this collection.
          </div>
        ) : null}
      </div>
    </TwoColumnPageShell>
  );
}