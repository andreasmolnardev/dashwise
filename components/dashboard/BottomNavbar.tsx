"use client";

import { useConfig } from "@/context/ConfigContext";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faGear, faMoon } from "@fortawesome/free-solid-svg-icons";
import PagesTabs from "../PagesTabs";
import UpdateDetailsDialogComponent from "./UpdateDetailsDialog";
import useAuth from "@/context/useAuth";
import { get } from "@/lib/apiClient";

interface BottomNavbarProps {
  activePanel?: number;
  setScreensaverActive?: (active: boolean) => void;
  showPages?: boolean;
}

export default function BottomNavbar({
  activePanel = 1,
  setScreensaverActive,
  showPages = true,
}: BottomNavbarProps) {
  const { config } = useConfig();
  const { token } = useAuth();
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [localScreensaverConfig, setLocalScreensaverConfig] = useState<any>(null);

  const isHomePage = pathname === "/home";

  useEffect(() => {
    const fetchNotifications = async () => {
      if (!token) return;

      try {
        const data = await get(`/notifications?count=true`, { token });
        setUnreadCount(data.unread || 0);
      } catch (err) {
        console.error(err);
      }
    };

    fetchNotifications();
  }, [token]);

  useEffect(() => {
    const checkLocal = () => {
      const local = localStorage.getItem("dashwise_screensaver_local");
      if (local) {
        setLocalScreensaverConfig(JSON.parse(local));
      } else {
        setLocalScreensaverConfig(null);
      }
    };

    checkLocal();
    window.addEventListener("dashwise_local_config_updated", checkLocal);
    return () => window.removeEventListener("dashwise_local_config_updated", checkLocal);
  }, []);

  const activeScreensaverConfig = localScreensaverConfig || config.appearance?.screensaver;

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center px-3 md:px-0" id="page-footer">
      <div id="app-details" className="flex items-center gap-2">
        <Link href="/home" className="flex items-center gap-2">
            <img src="/dashwise-icon.png" alt="" className="h-[36px]" />
            <span className="font-semibold">dashwise</span>
        </Link>

        <div className="aspect-square rounded-full frosted w-2 h-2"></div>

        <UpdateDetailsDialogComponent />
      </div>

      <div className="flex justify-center">
        {showPages && <PagesTabs />}

        {/* Mobile dot indicator, only in home page */}
        {showPages && isHomePage && (
            <div className="md:hidden fixed left-0 right-0 bottom-6 flex justify-center z-50 pointer-events-none">
            <div className="pointer-events-auto bg-transparent px-2 py-1 rounded-full">
                <DotIndicator
                showThreeDots={Boolean(config?.widgets?.[0]?.length && config?.widgets?.[2]?.length)}
                active={activePanel}
                />
            </div>
            </div>
        )}
      </div>

      <ul className="grid grid-flow-col auto-cols-max items-center justify-end gap-3">
        {activeScreensaverConfig?.showButton && setScreensaverActive && (
          <li>
            <div
              onClick={() => setScreensaverActive(true)}
              className="frosted px-2 py-1.5 rounded-full group transition-colors duration-200 cursor-pointer"
            >
              <FontAwesomeIcon
                icon={faMoon}
                className="text-(--text-primary) group-hover:text-(--primary) transition-colors duration-200 h-1.5"
              />
            </div>
          </li>
        )}
        {(typeof config?.integrations === "object" &&
          !Array.isArray(config?.integrations) &&
          config?.integrations !== null &&
          Object.keys(config?.integrations)
            .map((i: string) => i.toLowerCase())
            .includes("notifications")) && (
          <li className="relative">
            <Link
              href="/notifications"
              className="frosted p-2 rounded-full group transition-colors duration-200"
            >
              <FontAwesomeIcon
                icon={faBell}
                className="text-(--text-primary) group-hover:text-(--primary) transition-colors duration-200"
              />
            </Link>
            {unreadCount > 0 && (
              <span className="absolute -top-3 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-(--primary) text-[10px] font-bold text-white pointer-events-none">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </li>
        )}

        <li>
          <Link
            href="/settings/appearance"
            prefetch={false}
            className="frosted p-2 rounded-full group transition-colors duration-200"
          >
            <FontAwesomeIcon
              icon={faGear}
              className="text-(--text-primary) group-hover:text-(--primary) transition-colors duration-200"
            />
          </Link>
        </li>
      </ul>
    </div>
  );
}

function DotIndicator({ showThreeDots, active }: { showThreeDots: boolean; active: number }) {
  const dotBase = "inline-block w-2.5 h-2.5 rounded-full transition-transform transition-opacity";
  const activeClasses = "scale-110 opacity-100";
  const inactiveClasses = "scale-100 opacity-60";

  if (!showThreeDots) {
    return (
      <div className="flex items-center gap-2">
        <span
          className={`${dotBase} ${active === 1 ? activeClasses : inactiveClasses} bg-white`}
          aria-hidden
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className={`${dotBase} ${active === i ? activeClasses : inactiveClasses} bg-white`}
        />
      ))}
    </div>
  );
}
