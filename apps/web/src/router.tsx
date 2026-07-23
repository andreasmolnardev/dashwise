import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { homelabProduct } from "@/products/homelab";
import { moduleRoutes } from "@/platform/routing/routes";

const RootLayout = lazy(() => import("./app/layout"));
const RootPage = lazy(() => import("./app/page"));
const AuthLayout = lazy(() => import("./app/(auth)/auth/layout"));
const AuthRootPage = lazy(() => import("./app/(auth)/auth/page"));
const LoginPage = lazy(() => import("./app/(auth)/auth/login/page"));
const SignupPage = lazy(() => import("./app/(auth)/auth/signup/page"));
const AuthenticatedLayout = lazy(() => import("./app/(authenticated)/layout"));
const OnboardingPage = lazy(() => import("./app/(authenticated)/onboarding/page"));
const SettingsLayout = lazy(() => import("./app/(authenticated)/settings/layout"));
const SettingsPage = lazy(() => import("./app/(authenticated)/settings/page"));
const SettingsGeneralPage = lazy(() => import("./app/(authenticated)/settings/general/page"));
const SettingsAccountPage = lazy(() => import("./app/(authenticated)/settings/account/page"));
const SettingsAppearancePage = lazy(() => import("./app/(authenticated)/settings/appearance/page"));
const SettingsPagesPage = lazy(() =>
  import("@/modules/dashboard").then(({ DashboardSettingsPage }) => ({ default: DashboardSettingsPage })),
);
const SettingsIntegrationsPage = lazy(() => import("./app/(authenticated)/settings/integrations/page"));
const SettingsSearchPage = lazy(() => import("./app/(authenticated)/settings/search/page"));
const SettingsScreensaverPage = lazy(() => import("./app/(authenticated)/settings/screensaver/page"));
const FramePage = lazy(() => import("./app/(authenticated)/frame/page"));
const MigratePage = lazy(() => import("./app/(authenticated)/migrate/page"));

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
            ...moduleRoutes(homelabProduct.modules),
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
        ],
      },
      { path: "app/*", element: <Navigate to="/home" replace /> },
    ],
  },
]);
