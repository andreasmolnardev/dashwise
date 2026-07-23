import { Outlet } from "react-router-dom";
import LinksLayout from "./LinksLayout";

export default function LinksRootLayout() {
    return (
        <LinksLayout>
            <Outlet />
        </LinksLayout>
    );
}
