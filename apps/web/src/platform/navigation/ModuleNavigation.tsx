import type { ReactNode } from "react";
import AppTemplate, {
  Action,
  BottomTab,
  Content,
  GroupLabel,
  Sidebar,
  Tab,
  type DropdownAction,
} from "@/components/apps/LayoutTemplate";

type ItemContribution = {
  kind: "item";
  id: string;
  path: string;
  icon: string;
  label: string;
  group?: string;
  isRoot?: boolean;
  fallbackIcon?: string;
  badge?: number | string;
  hasError?: boolean;
  dropdownActions?: DropdownAction[];
};

type GroupContribution = {
  kind: "group";
  id: string;
  group: string;
  label?: string;
  collapsible?: boolean;
  actions?: Array<{ icon: string; title: string; action: () => void }>;
  dropdownActions?: DropdownAction[];
};

type BottomTabContribution = Omit<ItemContribution, "kind" | "group" | "fallbackIcon" | "hasError" | "dropdownActions"> & {
  kind: "bottom-tab";
};

type ActionContribution = {
  kind: "action";
  id: string;
  icon: string;
  label: string;
  action: () => void;
};

export type ModuleNavigationContribution =
  | ItemContribution
  | GroupContribution
  | BottomTabContribution
  | ActionContribution;

export function ModuleNavigation({
  title,
  contributions,
  children,
  overlays,
  dashboardPath = "/home",
}: {
  title: string;
  contributions: readonly ModuleNavigationContribution[];
  children: ReactNode;
  overlays?: ReactNode;
  dashboardPath?: string | false;
}) {
  return (
    <AppTemplate title={title}>
      <Sidebar dashboardPath={dashboardPath}>
        {contributions.map((contribution) => {
          switch (contribution.kind) {
            case "item":
              return <Tab key={contribution.id} dst={contribution.path} icon={contribution.icon} title={contribution.label} group={contribution.group} isRoot={contribution.isRoot} fallbackIcon={contribution.fallbackIcon} badge={contribution.badge} hasError={contribution.hasError} dropdownActions={contribution.dropdownActions} />;
            case "group":
              return <GroupLabel key={contribution.id} group={contribution.group} title={contribution.label} collapsible={contribution.collapsible} actions={contribution.actions} dropdownActions={contribution.dropdownActions} />;
            case "bottom-tab":
              return <BottomTab key={contribution.id} dst={contribution.path} icon={contribution.icon} title={contribution.label} isRoot={contribution.isRoot} badge={contribution.badge} />;
            case "action":
              return <Action key={contribution.id} icon={contribution.icon} title={contribution.label} action={contribution.action} />;
          }
        })}
      </Sidebar>
      <Content>{children}</Content>
      {overlays}
    </AppTemplate>
  );
}
