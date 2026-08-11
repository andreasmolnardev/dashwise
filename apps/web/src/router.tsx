import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

const RootLayout = lazy(() => import("./app/layout"));
const RootPage = lazy(() => import("./app/page"));
const AuthLayout = lazy(() => import("./app/(auth)/auth/layout"));
const AuthRootPage = lazy(() => import("./app/(auth)/auth/page"));
const LoginPage = lazy(() => import("./app/(auth)/auth/login/page"));
const SignupPage = lazy(() => import("./app/(auth)/auth/signup/page"));
const AuthenticatedLayout = lazy(() => import("./app/(authenticated)/layout"));
const OnboardingPage = lazy(() => import("./app/(authenticated)/onboarding/page"));
const DynamicPage = lazy(() => import("./app/(authenticated)/dashboard/[page]/page"));
const NewsPage = lazy(() => import("./app/(authenticated)/apps/news/page"));
const NewsLayout = lazy(() => import("./components/news/NewsLayout"));
const NotificationsPage = lazy(() => import("./app/(authenticated)/apps/monitoring/notifications/page"));
const NotificationsInboxPage = lazy(() => import("./app/(authenticated)/apps/notifications/inbox/page"));
const LinksLayout = lazy(() => import("./app/(authenticated)/apps/links/layout"));
const LinksPage = lazy(() => import("./app/(authenticated)/apps/links/page"));
const LinksHomePage = lazy(() => import("./app/(authenticated)/apps/links/home/page"));
const LinksListsPage = lazy(() => import("./app/(authenticated)/apps/links/lists/page"));
const LinksListDetailPage = lazy(() => import("./app/(authenticated)/apps/links/lists/[listId]/page"));
const LinksTagsPage = lazy(() => import("./app/(authenticated)/apps/links/tags/page"));
const LinksTagDetailPage = lazy(() => import("./app/(authenticated)/apps/links/tags/[tagId]/page"));
const MonitoringLayout = lazy(() => import("./app/(authenticated)/apps/monitoring/layout"));
const MonitoringPage = lazy(() => import("./app/(authenticated)/apps/monitoring/page"));
const MonitoringDetailPage = lazy(() => import("./app/(authenticated)/apps/monitoring/[monitorId]/page"));
const MonitoringSshPage = lazy(() => import("./app/(authenticated)/apps/monitoring/ssh/page"));
const MonitoringHostPage = lazy(() => import("./app/(authenticated)/apps/monitoring/hosts/page"));
const SettingsLayout = lazy(() => import("./app/(authenticated)/settings/layout"));
const SettingsPage = lazy(() => import("./app/(authenticated)/settings/page"));
const SettingsGeneralPage = lazy(() => import("./app/(authenticated)/settings/general/page"));
const SettingsAccountPage = lazy(() => import("./app/(authenticated)/settings/account/page"));
const SettingsAppearancePage = lazy(() => import("./app/(authenticated)/settings/appearance/page"));
const SettingsPagesPage = lazy(() => import("./app/(authenticated)/settings/pages/page"));
const SettingsIntegrationsPage = lazy(() => import("./app/(authenticated)/settings/integrations/page"));
const SettingsSearchPage = lazy(() => import("./app/(authenticated)/settings/search/page"));
const SettingsScreensaverPage = lazy(() => import("./app/(authenticated)/settings/screensaver/page"));
const FramePage = lazy(() => import("./app/(authenticated)/frame/page"));
const MigratePage = lazy(() => import("./app/(authenticated)/migrate/page"));

const linksRoutes = [
  { index: true, element: <LinksPage /> },
  { path: "home", element: <LinksHomePage /> },
  { path: "lists", element: <LinksListsPage /> },
  { path: "lists/:listId", element: <LinksListDetailPage /> },
  { path: "tags", element: <LinksTagsPage /> },
  { path: "tags/:tagId", element: <LinksTagDetailPage /> },
];

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
             children: linksRoutes,
           },
           {
             path: "apps/links",
             element: <LinksLayout />,
             children: linksRoutes,
           },
           {
             path: "apps/monitoring",
             element: <MonitoringLayout />,
             children: [
                { index: true, element: <MonitoringPage /> },
                { path: "notifications", element: <NotificationsPage /> },
                { path: "ssh", element: <MonitoringSshPage /> },
                { path: "ssh/:hostId", element: <MonitoringSshPage /> },
                { path: "hosts/:hostId", element: <MonitoringHostPage /> },
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
