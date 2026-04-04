import { createBrowserRouter, Navigate } from "react-router-dom";
import RootLayout from "./app/layout";
import RootPage from "./app/page";
import AuthLayout from "./app/(auth)/auth/layout";
import AuthRootPage from "./app/(auth)/auth/page";
import LoginPage from "./app/(auth)/auth/login/page";
import SignupPage from "./app/(auth)/auth/signup/page";
import AuthenticatedLayout from "./app/(authenticated)/layout";
import OnboardingPage from "./app/(authenticated)/onboarding/page";
import DynamicPage from "./app/(authenticated)/[page]/page";
import NewsPage from "./app/(authenticated)/news/page";
import NewsOnboardingPage from "./app/(authenticated)/news/onboarding/page";
import NotificationsLayout from "./app/(authenticated)/notifications/layout";
import NotificationsPage from "./app/(authenticated)/notifications/page";
import NotificationsInboxPage from "./app/(authenticated)/notifications/inbox/page";
import NotificationsForwardersPage from "./app/(authenticated)/notifications/forwarders/page";
import NotificationsTokensPage from "./app/(authenticated)/notifications/tokens/page";
import SettingsLayout from "./app/(authenticated)/settings/layout";
import SettingsPage from "./app/(authenticated)/settings/page";
import SettingsGeneralPage from "./app/(authenticated)/settings/general/page";
import SettingsAccountPage from "./app/(authenticated)/settings/account/page";
import SettingsAppearancePage from "./app/(authenticated)/settings/appearance/page";
import SettingsPagesPage from "./app/(authenticated)/settings/pages/page";
import SettingsIntegrationsPage from "./app/(authenticated)/settings/integrations/page";
import SettingsSearchPage from "./app/(authenticated)/settings/search/page";
import SettingsScreensaverPage from "./app/(authenticated)/settings/screensaver/page";

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
          { path: "news", element: <NewsPage /> },
          { path: "news/onboarding", element: <NewsOnboardingPage /> },
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
          { path: "onboarding", element: <OnboardingPage /> },
          { path: ":page", element: <DynamicPage /> },
        ],
      },
      { path: "app/*", element: <Navigate to="/home" replace /> },
    ],
  },
]);
