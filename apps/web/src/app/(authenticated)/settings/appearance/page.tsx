
import React, { useState } from "react";
import { Label } from "@/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { Icon } from "@iconify-icon/react";
import UploadWallpaperDialogComponent from "@/components/settings/UploadWallpaperDialog";
import UrlWallpaperDialogComponent from "@/components/settings/UrlWallpaperDialog";
import ThemeSelectComponent from "@/components/settings/ThemeSelect";
import WallpaperBlurSliderComponent from "@/components/settings/WallpaperBlurSlider";
import ClockFontSelectionCarousel from "@/components/settings/ClockFontSelectionCarousel";
import WallpaperBrightnessSliderComponent, { WallpaperBrightnessDarkModeSliderComponent } from "@/components/settings/WallpaperBrightnessSlider";
import WallpaperSourceControl from "@/components/settings/WallpaperSourceControl";
import useAuth from "@/context/useAuth";
import config from "@/lib/config";

export default function AppearanceSettingsPage() {
  const { user } = useAuth();
  const [value, setValue] = useState("current");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);

  const imageUrl = user?.appearancePreferences?.backgroundImageUrl || "";
  const showSourceControl = !imageUrl.includes(config.app_base_url) && !imageUrl.startsWith("/api");

  return (
    <>
      <h1 className="text-3xl font-semibold mb-4">Appearance</h1>

      <div className="content space-y-2">
        <h2 className="text-xl font-bold">Wallpaper</h2>
        <RadioGroup
          value={value}
          onValueChange={(v) => {
            setValue(v);
            if (v === "upload") setUploadDialogOpen(true);
            if (v === "add-url") setUrlDialogOpen(true);
          }}
          className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] px-2 mb-4"
        >
          <div>
            <RadioGroupItem id="r1" value="current" className="peer sr-only" />
            <Label
              htmlFor="r1"
              className="group flex flex-col items-center justify-center rounded-xl outline outline-transparent outline-offset-2 p-3 text-center cursor-pointer frosted text-xl
                 peer-data-[state=checked]:outline-(--primary)
                 peer-focus-visible:outline peer-focus-visible:outline-(--primary) h-22"
            >
              <Icon className="group-hover:text-(--primary) transition-colors" icon="fa6-solid:image" />
              <span className="text-lg">Current</span>
            </Label>
          </div>

          <div>
            <RadioGroupItem id="r2" value="upload" className="peer sr-only" />
            <Label
              htmlFor="r2"
              className="group flex flex-col items-center justify-center rounded-xl outline outline-transparent p-3 text-center cursor-pointer frosted text-xl
                 peer-data-[state=checked]:outline-(--primary)
                 peer-focus-visible:outline peer-focus-visible:outline-(--primary) h-22"
            >
              <Icon className="group-hover:text-(--primary) transition-colors" icon="fa6-solid:upload" />
              <span className="text-lg">Upload</span>
            </Label>
          </div>

          <div>
            <RadioGroupItem id="r3" value="add-url" className="peer sr-only" />
            <Label
              htmlFor="r3"
              className="group flex flex-col items-center justify-center rounded-xl outline outline-transparent p-3 text-center cursor-pointer frosted text-xl
                 peer-data-[state=checked]:outline-(--primary)
                 peer-focus-visible:outline peer-focus-visible:outline-(--primary) h-22"
            >
              <Icon className="group-hover:text-(--primary) transition-colors" icon="fa6-solid:paperclip" />
              <span className="text-lg">Add from URL</span>
            </Label>
          </div>
        </RadioGroup>

        {/* Upload dialog */}
        <UploadWallpaperDialogComponent
          open={uploadDialogOpen}
          onOpenChange={(o) => {
            setUploadDialogOpen(o);
            if (!o) setValue("current"); // reset selection when dialog closes
          }}
        />

        {/* URL dialog */}
        <UrlWallpaperDialogComponent
          open={urlDialogOpen}
          onOpenChange={(o) => {
            setUrlDialogOpen(o);
            if (!o) setValue("current"); // reset selection when dialog closes
          }}
          configKey="settings/appearance"
        />

        {showSourceControl && (
          <>
            <h3 className="text-lg font-medium">Source Control</h3>
            <WallpaperSourceControl />
          </>
        )}


        <h3 className="text-lg font-medium">Wallpaper Filters</h3>

        <WallpaperBrightnessSliderComponent />
        <WallpaperBrightnessDarkModeSliderComponent />
        <WallpaperBlurSliderComponent />

        <h2 className="text-xl font-semibold">Theme</h2>

        {/* Accent color moved to its own component */}
        <ThemeSelectComponent/>

        <h3 className="text-lg font-medium">Clock</h3>
        <ClockFontSelectionCarousel/>
      </div>
    </>
  );
}
