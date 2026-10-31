// One URL per page, so every tab can be opened, reloaded and shared on its own.
export type Route = { page: string; folder: string; settingsTab: string };
export const settingsTabs = ["team", "workspace", "account", "support", "audit"];
const pagePaths: Record<string, string> = {
  codes: "/",
  analytics: "/analytics",
  designs: "/designs",
  media: "/media",
  plans: "/plans",
  operator: "/control-room",
};
export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  const route = { page: "codes", folder: "", settingsTab: "team" };
  const folder = path.match(/^\/folders\/([\w-]+)$/);
  if (folder) return { ...route, folder: folder[1] };
  const settings = path.match(/^\/settings(?:\/([a-z]+))?$/);
  if (settings)
    return {
      ...route,
      page: "settings",
      settingsTab: settingsTabs.includes(settings[1] || "")
        ? settings[1]
        : "team",
    };
  const hit = Object.entries(pagePaths).find(([, p]) => p === path);
  return hit ? { ...route, page: hit[0] } : route;
}
export function pathFor(page: string, folder = "", settingsTab = "team") {
  if (page === "settings")
    return settingsTab === "team" ? "/settings" : `/settings/${settingsTab}`;
  if (page === "codes" && folder) return `/folders/${folder}`;
  return pagePaths[page] || "/";
}
