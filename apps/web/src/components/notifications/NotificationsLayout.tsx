"use client";
import { Link, useLocation } from "react-router-dom";
// icon constants replaced with Iconify slugs
// import { faHome, faInbox, faKey, faShareNodes } from "@fortawesome/free-solid-svg-icons";
import { Label } from "@/components/ui/label";
import { useCallback, useEffect, useRef, useState } from "react";
import useAuth from "@/context/useAuth";
import { getNotificationsAction } from "@/app/actions/notifications/items";
import { Icon } from "@iconify-icon/react";
import { NOTIFICATIONS_UPDATED_EVENT } from "@/lib/events";
import config from "@/lib/config";

const navItems = [
    { href: "/notifications/inbox", label: "Inbox", icon: "fa6-solid:inbox" },
    { href: "/notifications/forwarders", label: "Forwarders", icon: "fa6-solid:share-nodes" },
    { href: "/notifications/tokens", label: "Tokens", icon: "fa6-solid:key" },
];

export default function NotificationsLayoutComponent({ children }: { children: React.ReactNode }) {
    const pathname = useLocation().pathname;
    const activeBgRef = useRef<HTMLDivElement | null>(null);
    const [unreadCount, setUnreadCount] = useState<number>(0);

    const { token, withAuth } = useAuth();

    const fetchUnreadCount = useCallback(async () => {
        if (!token) return;

        try {
            const data = await withAuth((auth) => getNotificationsAction(auth, false, true));
            setUnreadCount(data.unread || 0);
        } catch (err) {
            console.error(err);
        }
    }, [token, withAuth]);

    useEffect(() => {
        fetchUnreadCount();
    }, [config.app_base_url, fetchUnreadCount]);

    useEffect(() => {
        const handleNotificationsUpdated = () => {
            fetchUnreadCount();
        };

        if (typeof window === "undefined") return;
        window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, handleNotificationsUpdated);
        return () => window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, handleNotificationsUpdated);
    }, [fetchUnreadCount]);

    useEffect(() => {
        const activeEl = document.querySelector<HTMLElement>(`.settings-label-div[data-href="${pathname}"]`);
        if (activeEl && activeBgRef.current) {
            const { offsetTop, offsetHeight } = activeEl;
            activeBgRef.current.style.top = offsetTop + "px";
            activeBgRef.current.style.height = offsetHeight + "px";
        }
    }, [pathname]);

    return (
        <div className="flex h-dvh bg-(--surface) backdrop-blur-[5px] backdrop-brightness-85 text-white p-8">
            <div className="w-[30%]">
                <h1 className="scroll-m-20 text-4xl font-bold tracking-tight text-balance">Notifications</h1>

                <div className="relative flex flex-col h-[calc(100%-35px)] justify-between py-4">
                    <div className="space-y-1">
                        <div
                            ref={activeBgRef}
                            className="absolute left-0 w-[90%] rounded-md bg-white/20 transition-all duration-300"
                            style={{ zIndex: 0 }}
                        />

                        {navItems.map((item) => (
                            <Link key={item.href} to={item.href} className="block group">
                                <div
                                    className={`flex items-center justify-between p-2 settings-label-div round-md relative ${pathname === item.href ? "font-bold" : ""}`}
                                    data-href={item.href}
                                >
                                    <div className="flex items-center space-x-2">
                                        <Icon icon={item.icon} className="text-lg group-hover:text-(--primary)" />
                                        <Label>{item.label}</Label>
                                    </div>

                                    {/* Show unread badge only for Inbox */}
                                    {item.href === "/notifications/inbox" && unreadCount > 0 && (
                                        <span className="ml-2 px-2 py-0.5 mr-10 bg-(--primary) rounded-full text-xs font-bold">
                                            {unreadCount}
                                        </span>
                                    )}
                                </div>
                            </Link>
                        ))}
                    </div>

                    <Link key="/home" to="/home" className="block group">
                        <div
                            className={`flex items-center space-x-2 p-2 settings-label-div round-md relative`}
                            data-href="/home"
                        >
                            <Icon icon="fa6-solid:house" className=" group-hover:text-(--primary)" />
                            <Label>Back Home</Label>
                        </div>
                    </Link>
                </div>

            </div>

            <div className="flex-1 overflow-y-auto">{children}</div>
        </div>
    );
}