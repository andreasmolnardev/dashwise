"use client";

import { useEffect, useState } from "react";
import { WidgetItemProps } from "../Widget";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperclip } from "@fortawesome/free-solid-svg-icons";

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
        <ul className="flex flex-col gap-1 w-full text-left h-32 overflow-y-auto pr-1">
          {data.map((bookmark) => (
            <li key={bookmark.id} className="min-w-0">

              <a
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                className="grid grid-cols-[20px_1fr] gap-2 truncate group"
              >
                {bookmark.icon ? (
                  <img
                    src={bookmark.icon}
                    alt=""
                    className="w-4 h-4 shrink-0 rounded-sm justify-self-center self-center"
                  />
                ) : (
                  <div className="w-4 h-4 shrink-0 bg-gray-400/30 rounded-sm justify-self-start" />
                )}
                <div className="flex flex-col">
                  <span className="font-semibold  group-hover:text-(--primary)">{bookmark.title}</span>
                  <p className="text-sm text-(--text-on-frosted)"><FontAwesomeIcon icon={faPaperclip} className="text-xs text-(--primary)"/>{bookmark.url}</p>
                </div>
              </a>

            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
