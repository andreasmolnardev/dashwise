"use client";

import { Link } from "react-router-dom";
import { Icon } from "@iconify-icon/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PopoverClose } from "@radix-ui/react-popover";

const quickLinks = [
  {href: "/home", label: "Home", icon: "fa6-solid:house"},
  {
    href: "/apps/monitoring/notifications",
    label: "Notifications",
    icon: "fa6-solid:bell",
  },
  {
    href: "/apps/news",
    label: "News",
    icon: "fa6-solid:newspaper",
  },
  {
    href: "/apps/links",
    label: "Links",
    icon: "fa6-solid:link",
  },
  {
    href: "/apps/monitoring",
    label: "Monitoring",
    icon: "fa6-solid:chart-line",
  },
  {
    href: "/frame",
    label: "Smart Frame",
    icon: "teenyicons:screen-solid",
  },
];

const companionRepos = [
  {
    href: "https://github.com/dashwise-homelab/chrome",
    label: "Extension",
    icon: "mdi:google-chrome",
  },
  {
    href: "https://github.com/dashwise-homelab/integrations",
    label: "Integrations",
    icon: "fa6-solid:plug",
  },
  {
    href: "https://github.com/dashwise-homelab/framecompanion",
    label: "Frame Companion",
    icon: "teenyicons:screen-solid",
  },
];

export default function QuickLaunchPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="frosted rounded-full p-1.5 transition-colors duration-200 group aspect-square flex items-center justify-center"
          aria-label="Open quick launch menu"
        >
          <Icon
            icon="mynaui:grid-solid"
            className="p-1 md:p-0 text-foreground group-hover:text-primary transition-colors duration-200"
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={12}
        className="w-[min(20rem,calc(100vw-1rem))] border border-white/10 frosted p-3 text-foreground shadow-2xl"
      >
        <h2 className="text-lg font-semibold">Apps menu</h2>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {quickLinks.map((item) => (
            <PopoverClose asChild key={item.href}>
              <Link
                to={item.href}
                className="group grid min-h-24 justify-items-center justify-center items-center rounded-2xl p-3 transition hover:-translate-y-0.5 hover:bg-white/10"
              >
                <div className="flex items-start justify-between gap-2">
                  <Icon
                    icon={item.icon}
                    width={24}
                    className="text-foreground/80 transition-colors group-hover:text-primary"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold leading-tight text-center">
                    {item.label}
                  </p>
                </div>
              </Link>
            </PopoverClose>
          ))}
        </div>

        <h2 className="text-lg font-semibold">More</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <PopoverClose asChild>
            <Link
              to="/settings/appearance"
              className="group grid min-h-24 justify-items-center justify-center items-center rounded-2xl p-3 transition hover:-translate-y-0.5 hover:bg-white/10"
            >
              <div className="flex items-start justify-between gap-2">
                <Icon
                  icon="fa6-solid:gear"
                  width={24}
                  className="text-foreground/80 transition-colors group-hover:text-primary"
                />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold leading-tight">Settings</p>
              </div>
            </Link>
          </PopoverClose>

          <PopoverClose asChild>
            <Link
              to="/migrate"
              className="group grid min-h-24 justify-items-center justify-center items-center rounded-2xl p-3 transition hover:-translate-y-0.5 hover:bg-white/10"
            >
              <div className="flex items-start justify-between gap-2">
                <Icon
                  icon="fa6-solid:link"
                  width={24}
                  className="text-foreground/80 transition-colors group-hover:text-primary"
                />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold leading-tight">
                  Migrations
                </p>
              </div>
            </Link>
          </PopoverClose>
          <PopoverClose asChild>
            <a
              href="https://github.com/andreasmolnardev/dashwise-next"
              target="_blank"
              rel="noreferrer"
              className="group grid min-h-24 justify-items-center justify-center items-center rounded-2xl p-3 transition hover:-translate-y-0.5 hover:bg-white/10"
            >
              <div className="flex items-start justify-between gap-2">
                <Icon
                  icon="mdi:github"
                  width={24}
                  className="text-foreground/80 transition-colors group-hover:text-primary"
                />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold leading-tight">GitHub</p>
              </div>
            </a>
          </PopoverClose>
        </div>

        <h2 className="mt-4 text-lg font-semibold">Companion repositories</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {companionRepos.map((item) => (
            <PopoverClose asChild key={item.href}>
              <a
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="group grid min-h-24 justify-items-center justify-center items-center rounded-2xl p-3 transition hover:-translate-y-0.5 hover:bg-white/10"
              >
                <div className="flex items-start justify-between gap-2">
                  <Icon
                    icon={item.icon}
                    width={24}
                    className="text-foreground/80 transition-colors group-hover:text-primary"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-center text-sm font-semibold leading-tight">
                    {item.label}
                  </p>
                </div>
              </a>
            </PopoverClose>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
