"use client";

import { Link, useLocation } from "react-router-dom";
import { Icon } from "@iconify-icon/react";
import AppIcon from "@dashwise/app-icon";
import SearchBar from "@/components/widgets/SearchBar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Children,
    createContext,
    isValidElement,
    ReactNode,
    useContext,
    useEffect,
    useState,
} from "react";

// ─── Context ─────────────────────────────────────────────────────────────────

interface SidebarContextValue {
    pathname: string;
    search: string;
    closeMobileSidebar?: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
    pathname: "",
    search: "",
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DropdownAction {
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
    fallbackIcon?: string;
    badge?: number | string;
    hasError?: boolean;
    dropdownActions?: DropdownAction[];
}

interface BottomTabProps {
    dst: string;
    icon: string;
    title: string;
    isRoot?: boolean;
}

interface ActionProps {
    icon: string;
    title: string;
    action: () => void;
}

interface GroupLabelAction {
    icon: string;
    title: string;
    action: () => void;
}

interface GroupLabelProps {
    group?: string;
    title?: string;
    collapsible?: boolean;
    collapsed?: boolean;
    actions?: GroupLabelAction[];
    dropdownActions?: DropdownAction[];
}

// ─── AppTemplate ──────────────────────────────────────────────────────────────

export default function AppTemplate({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    const location = useLocation();
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const childArray = Children.toArray(children);

    const sidebar = childArray.find(
        (c) => isValidElement(c) && (c as React.ReactElement).type === Sidebar,
    );

    const content = childArray.find(
        (c) => isValidElement(c) && (c as React.ReactElement).type === Content,
    );

    const overlays = childArray.filter(
        (c) =>
            isValidElement(c) &&
            (c as React.ReactElement).type !== Sidebar &&
            (c as React.ReactElement).type !== Content,
    );

    useEffect(() => {
        setMobileSidebarOpen(false);
    }, [location.pathname, location.search]);

    return (
        <SidebarContext.Provider value={{
            pathname: location.pathname,
            search: location.search,
            closeMobileSidebar: () => setMobileSidebarOpen(false),
        }}>
            <div className="relative flex h-dvh overflow-hidden bg-(--surface) text-white backdrop-blur-[5px] backdrop-brightness-85">
                <div className="hidden md:flex w-65 shrink-0 flex-col p-4 pr-0">
                    <h1 className="text-4xl font-bold tracking-tight text-balance mb-1 shrink-0">
                        {title}
                    </h1>
                    <div className="flex-1 min-h-0 pr-4">{sidebar}</div>
                </div>

                <div className="flex min-w-0 flex-1 flex-col p-4 md:pl-0 gap-4 overflow-y-scroll">
                    <div className="flex items-center justify-between gap-3 md:hidden shrink-0">
                        <button
                            type="button"
                            onClick={() => setMobileSidebarOpen(true)}
                            className="frosted-lite inline-flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition-colors hover:text-white"
                            aria-label="Open sidebar"
                            title="Open sidebar"
                        >
                            <Icon icon="fa6-solid:bars" className="text-sm" />
                        </button>

                        <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">
                            {title}
                        </h1>

                        <div className="h-10 w-10" aria-hidden />
                    </div>

                    <div className="min-h-0 flex-1">{content}</div>
                </div>

                <div
                    className={`fixed inset-0 z-40 md:hidden transition-opacity duration-200 ${
                        mobileSidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
                    }`}
                    aria-hidden={!mobileSidebarOpen}
                >
                    <button
                        type="button"
                        aria-label="Close sidebar"
                        className="absolute inset-0 bg-black/55"
                        onClick={() => setMobileSidebarOpen(false)}
                        tabIndex={mobileSidebarOpen ? 0 : -1}
                    />

                    <aside
                        className={`frosted absolute left-0 top-0 h-full w-[min(84vw,19rem)] border-r border-white/10 bg-(--surface) p-4 shadow-2xl transition-transform duration-250 ease-out ${
                            mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
                        }`}
                    >
                        <div className="flex h-full min-h-0 flex-col">
                            <div className="mb-4 flex items-center justify-between gap-3 shrink-0">
                                <h1 className="min-w-0 truncate text-3xl font-bold tracking-tight">
                                    {title}
                                </h1>
                                <button
                                    type="button"
                                    onClick={() => setMobileSidebarOpen(false)}
                                    className="frosted-lite inline-flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition-colors hover:text-white"
                                    aria-label="Close sidebar"
                                    title="Close sidebar"
                                >
                                    <Icon icon="fa6-solid:xmark" className="text-sm" />
                                </button>
                            </div>

                            <div className="min-h-0 flex-1 overflow-hidden">{sidebar}</div>
                        </div>
                    </aside>
                </div>
            </div>

            {overlays}
        </SidebarContext.Provider>
    );
}

// ─── Tab ─────────────────────────────────────────────────────────────────────

export function Tab({ dst, icon, title, group, isRoot, fallbackIcon, badge, hasError, dropdownActions }: TabProps) {
    const { pathname, search, closeMobileSidebar } = useContext(SidebarContext);
    const destination = new URL(dst, "http://dashwise.local");
    const isActive = destination.search
        ? pathname === destination.pathname && search === destination.search
        : (isRoot
            ? pathname === destination.pathname
            : pathname === destination.pathname || pathname.startsWith(`${destination.pathname}/`));

    return (
        <div className="relative">
            <div className={`group flex items-center justify-between px-3 py-3 h-10 rounded-md relative z-10 select-none transition-all duration-150 frosted-lite ${hasError ? "bg-red-500/20 text-red-100" : ""}`}>
                <Link
                    to={dst}
                    className="flex min-w-0 flex-1 items-center gap-2"
                    onClick={() => closeMobileSidebar?.()}
                >
                    <AppIcon
                        source={icon}
                        fallbackSource={fallbackIcon}
                        alt={title}
                        className={`h-4 w-4 shrink-0 transition-colors ${hasError
                            ? "text-red-300"
                            : isActive
                                ? "text-primary"
                                : "text-white/60 group-hover:text-primary"
                        }`}
                        imageClassName="object-contain"
                    />
                    <span
                        className={`leading-none transition-colors ${
                            isActive
                                ? "text-white"
                                : hasError
                                    ? "text-red-100"
                                : "text-white/70 group-hover:text-white"
                        }`}
                    >
                        {title}
                    </span>
                </Link>

                {badge !== undefined && (
                    <span className="ml-auto mr-1 px-1.5 py-0.5 bg-primary rounded-full text-[10px] font-bold leading-none">
                        {badge}
                    </span>
                )}

                {dropdownActions && dropdownActions.length > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/10"
                            >
                                <Icon
                                    icon="fa6-solid:ellipsis"
                                    className="text-xs text-white/60"
                                />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="frosted text-foreground min-w-40">
                            {dropdownActions.map((action, index) => (
                                <DropdownMenuItem
                                    key={index}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        action.action();
                                    }}
                                    className="cursor-pointer"
                                >
                                    {action.icon && (
                                        <Icon icon={action.icon} className="text-sm" />
                                    )}
                                    {action.label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </div>
    );
}

// ─── BottomTab ────────────────────────────────────────────────────────────────

export function BottomTab({ dst, icon, title, isRoot }: BottomTabProps) {
    const { pathname, search, closeMobileSidebar } = useContext(SidebarContext);
    const destination = new URL(dst, "http://dashwise.local");
    const isActive = destination.search
        ? pathname === destination.pathname && search === destination.search
        : (isRoot
            ? pathname === destination.pathname
            : pathname === destination.pathname || pathname.startsWith(`${destination.pathname}/`));

    return (
        <Link
            to={dst}
            onClick={() => closeMobileSidebar?.()}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md group"
        >
            <Icon
                icon={icon}
                className={`text-sm font-medium transition-colors w-4 ${
                    isActive ? "text-primary" : "text-white/40 group-hover:text-primary"
                }`}
            />
            <span
                className={`text-sm leading-none transition-colors ${
                    isActive ? "text-white" : "text-white/50 group-hover:text-white"
                }`}
            >
                {title}
            </span>
        </Link>
    );
}

// ─── Action ──────────────────────────────────────────────────────────────────

export function Action({ icon, title, action }: ActionProps) {
    return (
        <button
            onClick={action}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors group"
        >
            <Icon
                icon={icon}
                className="text-sm group-hover:text-primary transition-colors"
            />
            <span className="text-sm leading-none">{title}</span>
        </button>
    );
}

export function GroupLabel(_props: GroupLabelProps) {
    return null;
}

function SidebarGroupHeader({
    title,
    groupKey,
    collapsible,
    collapsed,
    onToggle,
    actions,
    dropdownActions,
}: {
    title: string;
    groupKey: string;
    collapsible: boolean;
    collapsed: boolean;
    onToggle: () => void;
    actions: GroupLabelAction[];
    dropdownActions: DropdownAction[];
}) {
    return (
        <div className="group relative rounded-sm frosted-lite flex items-center justify-between px-2 mt-1">
            <button
                type="button"
                onClick={collapsible ? onToggle : undefined}
                className="flex w-full items-center gap-1 rounded px-1 py-2 text-left text-[11px] text-white/45 hover:text-white/75"
                title={title}
            >
                {collapsible && (
                    <Icon
                        icon="fa6-solid:chevron-right"
                        className="text-[10px] w-4 transition-transform duration-250"
                        style={{
                            transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
                            transitionTimingFunction: "cubic-bezier(0.4,0,0.2,1)",
                        }}
                    />
                )}
                <span className="truncate w-full">{title}</span>
            </button>

            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                {actions.map((action, index) => (
                    <button
                        key={`${groupKey}-action-${index}`}
                        type="button"
                        onClick={action.action}
                        title={action.title}
                        className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white"
                    >
                        <Icon icon={action.icon} className="text-xs" />
                    </button>
                ))}

                {dropdownActions.length > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                title="More actions"
                                className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white"
                            >
                                <Icon icon="fa6-solid:ellipsis" className="text-xs" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="frosted text-foreground min-w-40">
                            <DropdownMenuLabel className="text-xs uppercase tracking-[0.12em] text-white/45">
                                {title}
                            </DropdownMenuLabel>
                            {dropdownActions.map((action, index) => (
                                <DropdownMenuItem
                                    key={`${groupKey}-dropdown-${index}`}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        action.action();
                                    }}
                                    className="cursor-pointer"
                                >
                                    {action.icon && <Icon icon={action.icon} className="text-sm" />}
                                    {action.label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </div>
    );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function groupTabs(
    children: ReactNode,
): Array<{ group: string | undefined; tabs: React.ReactElement<TabProps>[] }> {
    const groups: Array<
        { group: string | undefined; tabs: React.ReactElement<TabProps>[] }
    > = [];
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
    const tabs = Children.toArray(children).filter(
        (c) => isValidElement(c) && (c as React.ReactElement).type === Tab,
    ) as React.ReactElement<TabProps>[];

    const groupLabels = Children.toArray(children).filter(
        (c) => isValidElement(c) && (c as React.ReactElement).type === GroupLabel,
    ) as React.ReactElement<GroupLabelProps>[];

    const actions = Children.toArray(children).filter(
        (c) => isValidElement(c) && (c as React.ReactElement).type === Action,
    ) as React.ReactElement<ActionProps>[];

    const bottomTabs = Children.toArray(children).filter(
        (c) => isValidElement(c) && (c as React.ReactElement).type === BottomTab,
    ) as React.ReactElement<BottomTabProps>[];

    const grouped = groupTabs(tabs);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

    const groupLabelByGroup = new Map<string, React.ReactElement<GroupLabelProps>>();
    for (const groupLabel of groupLabels) {
        const key = groupLabel.props.group ?? "";
        if (!groupLabelByGroup.has(key)) {
            groupLabelByGroup.set(key, groupLabel);
        }
    }

    const groupOrder: string[] = [];
    const seenGroups = new Set<string>();
    Children.forEach(children, (child) => {
        if (!isValidElement(child)) return;

        const isSidebarChild = child.type === Tab || child.type === GroupLabel;
        if (!isSidebarChild) return;

        const groupKey = (child as React.ReactElement<TabProps | GroupLabelProps>).props.group ?? "";
        if (seenGroups.has(groupKey)) return;

        seenGroups.add(groupKey);
        groupOrder.push(groupKey);
    });

    const tabsByGroup = new Map<string, React.ReactElement<TabProps>[]>();
    for (const entry of grouped) {
        tabsByGroup.set(entry.group ?? "", entry.tabs);
    }

    return (
        <div className="relative flex flex-col h-full justify-between py-2">
            {/* Scrollable tab area — actions stay pinned above */}
            <div className="flex flex-col overflow-hidden flex-1 min-h-0">
                {/* Tab groups — scrollable */}
                <div className="overflow-y-auto flex-1">
                    <div className="space-y-1">
                        {groupOrder.map((groupKey, groupIndex) => {
                            const label = groupLabelByGroup.get(groupKey);
                            const groupTabs = tabsByGroup.get(groupKey) ?? [];
                            const displayLabel = label?.props.title ?? label?.props.group;
                            const collapsible = Boolean(label?.props.collapsible);
                            const collapsed = collapsible
                                ? (collapsedGroups[groupKey] ?? false)
                                : false;

                            return (
                                <div key={`${groupKey || "ungrouped"}-${groupIndex}`} className="rounded-xl overflow-hidden space-y-0.5">
                                    {label && displayLabel && (
                                        <SidebarGroupHeader
                                            title={displayLabel}
                                            groupKey={groupKey || "ungrouped"}
                                            collapsible={collapsible}
                                            collapsed={collapsed}
                                            onToggle={() => setCollapsedGroups((prev) => ({
                                                ...prev,
                                                [groupKey]: !collapsed,
                                            }))}
                                            actions={label?.props.actions ?? []}
                                            dropdownActions={label?.props.dropdownActions ?? []}
                                        />
                                    )}

                                    {!collapsed && (groupTabs.length > 0 ? (
                                        groupTabs.map((tab, tabIndex) => (
                                            <div
                                                key={`${groupKey || "ungrouped"}-tab-${tabIndex}`}
                                                style={{
                                                    animation: "tabDrop 0.24s ease-out both",
                                                    animationDirection: collapsed ? "reverse" : "normal",
                                                    animationDelay: `${tabIndex * 40}ms`,
                                                }}
                                            >
                                                {tab}
                                            </div>
                                        ))
                                    ) : (
                                        <div
                                            aria-disabled="true"
                                            className="pointer-events-none px-3 py-2 text-sm text-white/35 select-none frosted-lite rounded-md"
                                      >
                                            No items available
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Bottom slot — BottomTabs, Actions, Go to dashboard */}
            <div className="shrink-0 pt-2 border-t border-white/10 mt-2">
                {bottomTabs.length > 0 && (
                    <div className="shrink-0 space-y-0.5 mb-1">
                        {bottomTabs.map((bt, i) => <div key={i}>{bt}</div>)}
                    </div>
                )}

                {actions.length > 0 && (
                    <div className="shrink-0 border-white/10 space-y-0.5">
                        {actions.map((a, i) => <div key={i}>{a}</div>)}
                    </div>
                )}

                <div className="mb-1">
                    <SearchBar useRedirect={false} />
                </div>

                <Link to="/home" className="block group">
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md">
                        <Icon
                            icon="fa6-solid:house"
                            className="text-sm text-white/40 group-hover:text-primary transition-colors w-4"
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
