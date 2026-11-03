import { Outlet } from "react-router-dom";
import AppTemplate, { Content, Sidebar, Tab } from "@/components/apps/LayoutTemplate";

export default function ViewsRootLayout() {
  return (
    <AppTemplate title="Views">
      <Sidebar>
        <Tab dst="/apps/views" icon="fa6-solid:table-list" title="Saved views" isRoot />
      </Sidebar>
      <Content>
        <Outlet />
      </Content>
    </AppTemplate>
  );
}
