"use client";
import { Link, useLocation } from "react-router-dom";
import { usePageConfig } from "@/hooks/usePageConfig";
import { useEffect, useRef } from "react";
import { Label } from "@/components/ui/label";
import { faBrush, faChartLine, faCircleUser, faCircleXmark, faDisplay, faGripLines, faMagnifyingGlass, faPaperclip, faPuzzlePiece, faSliders } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const navItems = [
  { href: "/settings/account", label: "Account", icon: faCircleUser },
  { href: "/settings/appearance", label: "Appearance", icon: faBrush },
  { href: "/settings/pages", label: "Pages", icon: faGripLines },
  { href: "/settings/screensaver", label: "Frame", icon: faDisplay },
  { href: "/settings/search", label: "Search", icon: faMagnifyingGlass },
  { href: "/settings/integrations", label: "Integrations", icon: faPuzzlePiece },
  { href: "/settings/apps", label: "Apps Settings", icon: faChartLine },
  { href: "/settings/general", label: "General", icon: faSliders },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = useLocation().pathname;
  const activeBgRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const activeEl = document.querySelector<HTMLElement>(`.settings-label-div[data-href="${pathname}"]`);
    if (activeEl && activeBgRef.current) {
      const { offsetTop, offsetHeight } = activeEl;
      activeBgRef.current.style.top = offsetTop + "px";
      activeBgRef.current.style.height = offsetHeight + "px";
    }
  }, [pathname]);

  return (
    <div className="flex h-dvh bg-(--surface) text-white p-4">
      <div className="w-[25%]">
        <h1 className="scroll-m-20 text-4xl font-bold tracking-tight text-balance">Settings</h1>

        <div className="relative flex flex-col h-[calc(100%-35px)] justify-between py-4">
          <div className="space-y-1">
            <div
              ref={activeBgRef}
              className="frosted-lite-control-active absolute left-0 w-[95%] rounded-md transition-all duration-300"
              style={{ zIndex: 0 }}
            />

            {navItems.map((item) => (
              <Link key={item.href} to={item.href} className="block group">
                <div
                  className={`flex items-center space-x-2 p-2 settings-label-div round-md relative ${pathname === item.href ? "font-bold" : ""
                    }`}
                  data-href={item.href}
                >
                  <FontAwesomeIcon icon={item.icon} className="text-lg group-hover:text-(--primary)" />
                  <Label>{item.label}</Label>
                </div>
              </Link>
            ))}
          </div>

          <Link key="/home" to="/home" className="block group">
            <div
              className={`flex items-center space-x-2 p-2 settings-label-div round-md relative`}
              data-href="/home"
            >
              <FontAwesomeIcon icon={faCircleXmark} className=" group-hover:text-(--primary)"/>
              <Label>Close</Label>
            </div>
          </Link>
        </div>

      </div>

      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
