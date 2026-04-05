"use client";

import { Link, useLocation } from "react-router-dom";
import { Icon } from "@iconify-icon/react";
import { Label } from "@/components/ui/label";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    createContext,
    useContext,
    Children,
    isValidElement,
    ReactNode,
} from "react";

// ─── Context ─────────────────────────────────────────────────────────────────

interface SidebarContextValue {
    pathname: string;
}

const SidebarContext = createContext<SidebarContextValue>({
    pathname: "",
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface DropdownAction {
    label: string;
    icon?: string;
    action: () => void;
}

interface TabProps {
    dst: string;
    icon: string;
    title: string;
    group?: string;
    isRoot?: boolean;
    badge?: number | string;
    dropdownActions?: DropdownAction[];
}

interface ActionProps {
    icon: string;
    title: string;
    action: () => void;
}

// ─── Tab ─────────────────────────────────────────────────────────────────────

export function Tab({ dst, icon, title, badge, dropdownActions }: TabProps) {
    const { pathname } = useContext(SidebarContext);
    const isActive = pathname === dst || pathname.startsWith(`${dst}/`);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!dropdownOpen) return;
        const handler = (e: MouseEvent) => {
            if (!dropdownRef.current?.contains(e.target as Node)) setDropdownOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [dropdownOpen]);

    return (
        <div className="relative">
            <Link to={dst} className="block group">
                <div
                    className={`settings-label-div flex items-center justify-between px-2 py-1.5 rounded-md relative z-10 cursor-pointer select-none transition-all duration-150 frosted-lite`}
                    data-href={dst}
                >
                    <div className="flex items-center gap-2">
                        <Icon
                            icon={icon}
                            className={`text-sm transition-colors ${
                                isActive ? "text-primary" : "text-white/60 group-hover:text-primary"
                            }`}
                        />
                        <span
                            className={`text-sm leading-none transition-colors ${
                                isActive ? "text-white" : "text-white/70 group-hover:text-white"
                            }`}
                        >
                            {title}
                        </span>
                    </div>

                    {badge !== undefined && (
                        <span className="ml-auto mr-1 px-1.5 py-0.5 bg-primary rounded-full text-[10px] font-bold leading-none">
                            {badge}
                        </span>
                    )}

                    {dropdownActions && dropdownActions.length > 0 && (
                        <button
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDropdownOpen((v) => !v);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/10"
                        >
                            <Icon icon="fa6-solid:ellipsis" className="text-xs text-white/60" />
                        </button>
                    )}
                </div>
            </Link>

            {dropdownActions && dropdownOpen && (
                <div
                    ref={dropdownRef}
                    className="absolute left-full top-0 ml-1 z-50 min-w-35 rounded-md bg-(--surface) border border-white/10 shadow-lg overflow-hidden"
                >
                    {dropdownActions.map((a, i) => (
                        <button
                            key={i}
                            onClick={() => {
                                a.action();
                                setDropdownOpen(false);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors text-left"
                        >
                            {a.icon && <Icon icon={a.icon} className="text-xs" />}
                            {a.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Action ──────────────────────────────────────────────────────────────────

export function Action({ icon, title, action }: ActionProps) {
    return (
        <button
            onClick={action}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors group"
        >
            <Icon icon={icon} className="text-sm group-hover:text-primary transition-colors" />
            <span className="text-sm leading-none">{title}</span>
        </button>
    );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function groupTabs(children: ReactNode): Array<{ group: string | undefined; tabs: React.ReactElement<TabProps>[] }> {
    const groups: Array<{ group: string | undefined; tabs: React.ReactElement<TabProps>[] }> = [];
    const seen = new Map<string | undefined, number>();

    Children.forEach(children, (child) => {
        if (!isValidElement(child)) return;
        // Only process Tab elements
        const el = child as React.ReactElement<TabProps>;
        if ((el.type as any) !== Tab) return;

        const g = el.props.group;
        if (!seen.has(g)) {
            seen.set(g, groups.length);
            groups.push({ group: g, tabs: [] });
        }
        groups[seen.get(g)!].tabs.push(el);
    });

    return groups;
}

export function Sidebar({ children }: { children: ReactNode }) {
    const { pathname } = useContext(SidebarContext);

    const tabs = Children.toArray(children).filter(
        (c) => isValidElement(c) && (c as React.ReactElement).type === Tab
    ) as React.ReactElement<TabProps>[];

    const actions = Children.toArray(children).filter(
        (c) => isValidElement(c) && (c as React.ReactElement).type === Action
    ) as React.ReactElement<ActionProps>[];

    const grouped = groupTabs(tabs);

    return (
        <div className="relative flex flex-col h-full justify-between py-2">
            {/* Scrollable tab area — actions stay pinned above */}
            <div className="flex flex-col overflow-hidden flex-1 min-h-0">
                {/* Actions row — sticky, always visible above tabs */}
                {actions.length > 0 && (
                    <div className="shrink-0 pb-1 mb-1 border-b border-white/10 space-y-0.5">
                        {actions.map((a, i) => (
                            <div key={i}>{a}</div>
                        ))}
                    </div>
                )}

                {/* Tab groups — scrollable */}
                <div className="overflow-y-auto flex-1">
                    <div className="space-y-2">
                        {grouped.map(({ group, tabs }, gi) => (
                            <div
                                key={gi}
                                className={`${gi > 0 ? "pt-2 border-t border-white/10" : ""}`}
                            >
                                {/* Group label if group has a name */}
                                {group && (
                                    <p className="px-2 mb-0.5 text-[10px] uppercase tracking-widest text-white/30 font-medium select-none">
                                        {group}
                                    </p>
                                )}

                                {/* Tabs within group — tight spacing */}
                                <div className="space-y-0.5">
                                    {tabs.map((tab, ti) => (
                                        <div key={ti}>{tab}</div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Go to dashboard — always at bottom */}
            <div className="shrink-0 pt-2 border-t border-white/10 mt-2">
                <Link to="/home" className="block group">
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md">
                        <Icon
                            icon="fa6-solid:house"
                            className="text-sm text-white/40 group-hover:text-primary transition-colors"
                        />
                        <span className="text-sm text-white/50 group-hover:text-white transition-colors leading-none">
                            Go to dashboard
                        </span>
                    </div>
                </Link>
            </div>
        </div>
    );
}

// ─── Content ──────────────────────────────────────────────────────────────────

export function Content({ children }: { children: ReactNode }) {
    return <div className="flex-1 overflow-y-auto">{children}</div>;
}

// ─── AppTemplate ──────────────────────────────────────────────────────────────

export default function AppTemplate({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    const pathname = useLocation().pathname;
    const sidebar = Children.toArray(children).find(
        (c) => isValidElement(c) && (c as React.ReactElement).type === Sidebar
    );

    const content = Children.toArray(children).find(
        (c) => isValidElement(c) && (c as React.ReactElement).type === Content
    );

    return (
        <SidebarContext.Provider value={{ pathname }}>
            <div className="flex h-dvh bg-(--surface) backdrop-blur-[5px] backdrop-brightness-85 text-white p-8 gap-8">
                {/* Sidebar column */}
                <div className="w-55 shrink-0 flex flex-col">
                    <h1 className="text-4xl font-bold tracking-tight text-balance mb-4 shrink-0">{title}</h1>
                    <div className="flex-1 min-h-0">{sidebar}</div>
                </div>

                {/* Main content */}
                {content}
            </div>
        </SidebarContext.Provider>
    );
}