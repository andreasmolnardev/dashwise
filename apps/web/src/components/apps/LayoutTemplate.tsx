"use client";

import { Link, useLocation } from "react-router-dom";
import { Icon } from "@iconify-icon/react";
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
    useRef,
    useState,
} from "react";

// ─── Context ─────────────────────────────────────────────────────────────────

interface SidebarContextValue {
    pathname: string;
    search: string;
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
    badge?: number | string;
    dropdownActions?: DropdownAction[];
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

// ─── Tab ─────────────────────────────────────────────────────────────────────

export function Tab({ dst, icon, title, badge, dropdownActions }: TabProps) {
    const { pathname, search } = useContext(SidebarContext);
    const destination = new URL(dst, "http://dashwise.local");
    const isActive = destination.search
        ? pathname === destination.pathname && search === destination.search
        : pathname === destination.pathname || pathname.startsWith(`${destination.pathname}/`);

    return (
        <div className="relative">
            <div className="group flex items-center justify-between px-3 py-3 h-10 rounded-md relative z-10 select-none transition-all duration-150 frosted-lite">
                <Link to={dst} className="flex min-w-0 flex-1 items-center gap-2">
                    <Icon
                        icon={icon}
                        className={`transition-colors ${
                            isActive
                                ? "text-primary"
                                : "text-white/60 group-hover:text-primary"
                        }`}
                    />
                    <span
                        className={`leading-none transition-colors ${
                            isActive
                                ? "text-white"
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
        <div className="relative rounded-sm frosted-lite flex items-center justify-between px-2">
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

            <div className="flex items-center gap-1">
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

    const grouped = groupTabs(tabs);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

    const groupLabelByGroup = new Map<string, React.ReactElement<GroupLabelProps>>();
    for (const groupLabel of groupLabels) {
        const key = groupLabel.props.group ?? "";
        if (!groupLabelByGroup.has(key)) {
            groupLabelByGroup.set(key, groupLabel);
        }
    }

    const groupOrder = Array.from(new Set([
        ...grouped.map((entry) => entry.group ?? ""),
        ...groupLabels.map((entry) => entry.props.group ?? ""),
    ]));

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
                    <div className="space-y-2">
                        {groupOrder.map((groupKey, groupIndex) => {
                            const label = groupLabelByGroup.get(groupKey);
                            const groupTabs = tabsByGroup.get(groupKey) ?? [];
                            const displayLabel = label?.props.title || label?.props.group || groupKey;
                            const collapsible = Boolean(label?.props.collapsible);
                            const collapsed = collapsible
                                ? (collapsedGroups[groupKey] ?? Boolean(label?.props.collapsed))
                                : false;

                            return (
                                <div key={`${groupKey || "ungrouped"}-${groupIndex}`} className="rounded-xl overflow-hidden space-y-0.5">
                                    {displayLabel && (
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

                                    {!collapsed && groupTabs.map((tab, tabIndex) => (
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
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Go to dashboard — always at bottom */}
            <div className="shrink-0 pt-2 border-t border-white/10 mt-2">
                {actions.length > 0 && (
                    <div className="shrink-0 border-white/10 space-y-0.5">
                        {actions.map((a, i) => <div key={i}>{a}</div>)}
                    </div>
                )}

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
    const location = useLocation();
    const sidebar = Children.toArray(children).find(
        (c) => isValidElement(c) && (c as React.ReactElement).type === Sidebar,
    );

    const content = Children.toArray(children).find(
        (c) => isValidElement(c) && (c as React.ReactElement).type === Content,
    );

    return (
        <SidebarContext.Provider value={{ pathname: location.pathname, search: location.search }}>
            <div className="flex h-dvh bg-(--surface) backdrop-blur-[5px] backdrop-brightness-85 text-white p-4 gap-8">
                {/* Sidebar column */}
                <div className="w-55 shrink-0 flex flex-col">
                    <h1 className="text-4xl font-bold tracking-tight text-balance mb-4 shrink-0">
                        {title}
                    </h1>
                    <div className="flex-1 min-h-0">{sidebar}</div>
                </div>

                {/* Main content */}
                {content}
            </div>
        </SidebarContext.Provider>
    );
}