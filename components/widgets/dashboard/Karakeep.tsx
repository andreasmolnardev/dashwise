"use client";

import { useEffect, useState } from "react";
import { WidgetItemProps } from "../Widget";

type Bookmark = {
  id: string;
  title?: string;
  url: string;
  createdAt?: string;
  icon?: string | null;
};

export default function latestKarakeepBookmarksWidget({
  className = "",
}: WidgetItemProps) {
  const [data, setData] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("pb_token");

    if (!token) {
      return;
    }

    setLoading(true);

    fetch("/api/v1/integrations/karakeep?latest", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((r) => r.json())
      .then((d) => setData(d.latest ?? []))
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);


  return (
    <div
      className={`rounded-lg p-2 flex flex-col text-center items-start ${className}`}
    >
      <span className="font-medium mb-0.5">Latest Bookmarks</span>

      {loading && <span className="text-sm opacity-60">Loading…</span>}

      {!loading && data.length === 0 && (
        <span className="text-sm opacity-60">No bookmarks found.</span>
      )}

      {!loading && data.length > 0 && (
        <ul className="flex flex-col gap-1 w-full text-left max-h-48 overflow-y-auto pr-1">
          {data.map((bm) => (
            <li key={bm.id} className="text-sm flex items-center gap-2 min-w-0">
              {bm.icon ? (
                <img
                  src={bm.icon}
                  alt=""
                  className="w-4 h-4 shrink-0 rounded-sm"
                />
              ) : (
                <div className="w-4 h-4 shrink-0 bg-gray-400/30 rounded-sm" />
              )}

              <a
                href={bm.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline truncate"
              >
                {bm.title ?? bm.url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
