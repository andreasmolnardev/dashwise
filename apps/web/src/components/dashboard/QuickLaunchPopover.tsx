"use client";

import { Link } from "react-router-dom";
import { Icon } from "@iconify-icon/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PopoverClose } from "@radix-ui/react-popover";

const quickLinks = [
  {
    href: "/news",
    label: "News",
    icon: "fa6-solid:newspaper",
  },
  {
    href: "/notifications",
    label: "Notifications",
    icon: "fa6-solid:bell",
  },
  {
    href: "/links",
    label: "Links",
    icon: "fa6-solid:link",
  }
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
            className="text-foreground group-hover:text-(--primary) transition-colors duration-200"
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={12}
        className="w-[min(20rem,calc(100vw-1rem))] border border-white/10 frosted p-3 text-foreground shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Apps menu</h2>
          </div>
        </div>

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
                    className="text-foreground/80 transition-colors group-hover:text-(--primary)"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold leading-tight">{item.label}</p>
                  <p className="text-xs leading-snug opacity-70">{item.description}</p>
                </div>
              </Link>
            </PopoverClose>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}