import { createBrowserRouter, Navigate } from "react-router-dom";
import RootLayout from "./app/layout";
import RootPage from "./app/page";
import AuthLayout from "./app/(auth)/auth/layout";
import AuthRootPage from "./app/(auth)/auth/page";
import LoginPage from "./app/(auth)/auth/login/page";
import SignupPage from "./app/(auth)/auth/signup/page";
import AuthenticatedLayout from "./app/(authenticated)/layout";
import OnboardingPage from "./app/(authenticated)/onboarding/page";
import DynamicPage from "./app/(authenticated)/dashboard/[page]/page";
import NewsPage from "./app/(authenticated)/apps/news/page";
import NewsLayout from "./components/news/NewsLayout";
import NotificationsLayout from "./app/(authenticated)/apps/notifications/layout";
import NotificationsPage from "./app/(authenticated)/apps/notifications/page";
import NotificationsInboxPage from "./app/(authenticated)/apps/notifications/inbox/page";
import NotificationsForwardersPage from "./app/(authenticated)/apps/notifications/forwarders/page";
import NotificationsTokensPage from "./app/(authenticated)/apps/notifications/tokens/page";
import LinksLayout from "./app/(authenticated)/apps/links/layout";
import LinksPage from "./app/(authenticated)/apps/links/page";
import LinksHomePage from "./app/(authenticated)/apps/links/home/page";
import LinksListsPage from "./app/(authenticated)/apps/links/lists/page";
import LinksListDetailPage from "./app/(authenticated)/apps/links/lists/[listId]/page";
import LinksTagsPage from "./app/(authenticated)/apps/links/tags/page";
import LinksTagDetailPage from "./app/(authenticated)/apps/links/tags/[tagId]/page";
import MonitoringLayout from "./app/(authenticated)/apps/monitoring/layout";
import MonitoringPage from "./app/(authenticated)/apps/monitoring/page";
import MonitoringDetailPage from "./app/(authenticated)/apps/monitoring/[monitorId]/page";
import SettingsLayout from "./app/(authenticated)/settings/layout";
import SettingsPage from "./app/(authenticated)/settings/page";
import SettingsGeneralPage from "./app/(authenticated)/settings/general/page";
import SettingsAccountPage from "./app/(authenticated)/settings/account/page";
import SettingsAppearancePage from "./app/(authenticated)/settings/appearance/page";
import SettingsPagesPage from "./app/(authenticated)/settings/pages/page";
import SettingsIntegrationsPage from "./app/(authenticated)/settings/integrations/page";
import SettingsSearchPage from "./app/(authenticated)/settings/search/page";
import SettingsScreensaverPage from "./app/(authenticated)/settings/screensaver/page";
import FramePage from "./app/(authenticated)/frame/page";
import MigratePage from "./app/(authenticated)/migrate/page";

export const appRouter = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <RootPage /> },
      {
        path: "auth",
        element: <AuthLayout />,
        children: [
          { index: true, element: <AuthRootPage /> },
          { path: "login", element: <LoginPage /> },
          { path: "signup", element: <SignupPage /> },
        ],
      },
      {
        element: <AuthenticatedLayout />,
        children: [
           { path: "home", element: <DynamicPage /> },
            { path: "news", element: <Navigate to="/apps/news" replace /> },
            {
              path: "apps/news",
              element: (
                <NewsLayout>
                  <NewsPage />
                </NewsLayout>
              ),
            },
            {
              path: "apps/news/:feedId",
              element: (
                <NewsLayout>
                  <NewsPage />
                </NewsLayout>
              ),
            },
          {
            path: "links",
            element: <LinksLayout />,
            children: [
              { index: true, element: <LinksPage /> },
              { path: "home", element: <LinksHomePage /> },
              { path: "lists", element: <LinksListsPage /> },
              { path: "lists/:listId", element: <LinksListDetailPage /> },
              { path: "tags", element: <LinksTagsPage /> },
              { path: "tags/:tagId", element: <LinksTagDetailPage /> },
            ],
          },
          {
            path: "notifications",
            element: <NotificationsLayout />,
            children: [
              { index: true, element: <NotificationsPage /> },
              { path: "inbox", element: <NotificationsInboxPage /> },
              { path: "forwarders", element: <NotificationsForwardersPage /> },
              { path: "tokens", element: <NotificationsTokensPage /> },
            ],
          },
          {
            path: "apps/monitoring",
            element: <MonitoringLayout />,
            children: [
              { index: true, element: <MonitoringPage /> },
              { path: ":monitorId", element: <MonitoringDetailPage /> },
            ],
          },
          {
            path: "settings",
            element: <SettingsLayout />,
            children: [
              { index: true, element: <SettingsPage /> },
              { path: "general", element: <SettingsGeneralPage /> },
              { path: "account", element: <SettingsAccountPage /> },
              { path: "appearance", element: <SettingsAppearancePage /> },
              { path: "pages", element: <SettingsPagesPage /> },
              { path: "integrations", element: <SettingsIntegrationsPage /> },
              { path: "search", element: <SettingsSearchPage /> },
              { path: "screensaver", element: <SettingsScreensaverPage /> },
            ],
          },
          { path: "frame", element: <FramePage /> },
          { path: "onboarding", element: <OnboardingPage /> },
          { path: "migrate", element: <MigratePage /> },
          { path: ":page", element: <DynamicPage /> },
        ],
      },
      { path: "app/*", element: <Navigate to="/home" replace /> },
    ],
  },
]);
