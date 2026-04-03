type ActionModulePath =
  | "app"
  | "auth"
  | "config"
  | "get"
  | "integrations"
  | "links"
  | "misc"
  | "monitoring"
  | "news"
  | "notifications/forwarders"
  | "notifications/items"
  | "notifications/topicTokens"
  | "pageConfigs"
  | "post"
  | "searchItems"
  | "wallpapers"
  | "widgets";

const actionImporters: Record<ActionModulePath, () => Promise<Record<string, unknown>>> = {
  app: () => import("./actions/app"),
  auth: () => import("./actions/auth"),
  config: () => import("./actions/config"),
  get: () => import("./actions/get"),
  integrations: () => import("./actions/integrations"),
  links: () => import("./actions/links"),
  misc: () => import("./actions/misc"),
  monitoring: () => import("./actions/monitoring"),
  news: () => import("./actions/news"),
  "notifications/forwarders": () => import("./actions/notifications/forwarders"),
  "notifications/items": () => import("./actions/notifications/items"),
  "notifications/topicTokens": () => import("./actions/notifications/topicTokens"),
  pageConfigs: () => import("./actions/pageConfigs"),
  post: () => import("./actions/post"),
  searchItems: () => import("./actions/searchItems"),
  wallpapers: () => import("./actions/wallpapers"),
  widgets: () => import("./actions/widgets"),
};

export async function dispatchAction(modulePath: string, actionName: string, args: unknown[]) {
  const importer = actionImporters[modulePath as ActionModulePath];
  if (!importer) {
    throw new Error(`Unknown action module: ${modulePath}`);
  }

  const mod = await importer();
  const fn = mod[actionName];

  if (typeof fn !== "function") {
    throw new Error(`Unknown action: ${modulePath}.${actionName}`);
  }

  return await (fn as (...fnArgs: unknown[]) => Promise<unknown>)(...(args ?? []));
}
