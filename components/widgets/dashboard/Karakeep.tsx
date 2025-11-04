"use client";

import { useEffect, useState } from "react";
import { WidgetItemProps } from "../Widget";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperclip, faUpRightFromSquare } from "@fortawesome/free-solid-svg-icons";

type Bookmark = {
  id: string;
  title?: string;
  url: string;
  createdAt?: string;
  icon?: string | null;
};

type KarakeepResponse = {
  latest: Bookmark[];
  serverDetails: { url: string };
};


export default function latestKarakeepBookmarksWidget({
  className = "",
}: WidgetItemProps) {
  const [data, setData] = useState<KarakeepResponse | null>(null);
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
      .then((d) => {setData(d ?? {}); console.log(data)})
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);


  return (
    <div
      className={`rounded-lg p-2 flex flex-col text-center items-start ${className}`}
    >
      <a className="font-medium mb-0.5 grid grid-cols-[18px_1fr_16px] w-full text-start items-center justify-center gap-2.5" href={data?.serverDetails?.url}>
        <img src="/icons/png/karakeep-light.png" className="h-4 mx-0.5"/>
        <p className="font-semibold">Latest Bookmarks</p>
        <FontAwesomeIcon icon={faUpRightFromSquare} className="text-xs hover:text-(--primary)"/>
      </a>

      {loading && <span className="text-sm opacity-60">Loading…</span>}

      {!loading && data?.latest.length === 0 && (
        <span className="text-sm opacity-60">No bookmarks found.</span>
      )}

      {!loading && data?.latest?.[0] && (
        <ul className="flex flex-col gap-1 w-full text-left h-32 overflow-y-auto pr-1">
          {data?.latest.map((bookmark) => (
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
