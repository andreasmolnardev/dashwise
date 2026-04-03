"use client";

import { useState, useEffect } from "react";
import { PaginatedCarouselViewComponent } from "../widgets/PaginatedCarouselView";
import { usePageConfig } from "@/src/hooks/usePageConfig";
import { useAuth } from "@/src/context/useAuth";
import { loadFont } from "@/src/lib/loadFont";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "./ColorPicker";
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

type FontEntry = {
  name: string;
  path: string;
};

export interface ClockAppearance {
  defaultFont?: string | null;
  fontWeight?: number;
  letterSpacing?: number;
  outlineEnabled?: boolean;
  outlineColor?: string;
  outlineWidth?: number;
  color?: string;
  opacity?: number;
}

export default function ClockSelectionCarousel() {
  const { config, refreshConfig } = usePageConfig();
  const { updateUserProperty } = useAuth();

  const DEFAULT_FONT = "Default";

  // list of available fonts (includes a "Default" option with empty path)
  const [fonts, setFonts] = useState<FontEntry[]>([]);

  // selected font name (no localStorage persistence anymore)
  const [selected, setSelected] = useState<string>(() => DEFAULT_FONT);
  
  // Customization states
  const [fontWeight, setFontWeight] = useState(600);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [outlineEnabled, setOutlineEnabled] = useState(false);
  const [outlineColor, setOutlineColor] = useState("#000000");
  const [outlineWidth, setOutlineWidth] = useState(1);
  const [color, setColor] = useState("#ffffff");
  const [opacity, setOpacity] = useState(1);

  // Fetch font list and add "Default" option
  useEffect(() => {
    let mounted = true;
    fetch("/fonts/index.json")
      .then((r) => r.json())
      .then((data: FontEntry[]) => {
        if (!mounted) return;
        const fixed = data.map((f) => ({ name: f.name, path: f.path }));
        setFonts([{ name: "Default", path: "" }, ...fixed]);
      })
      .catch((e) => console.error("Failed to load fonts", e));

    return () => {
      mounted = false;
    };
  }, []);

  // When config loads, adopt server's appearance.clock (or fallback)
  useEffect(() => {
    if (!config) return;
    const clock = config?.appearance?.clock as ClockAppearance | undefined;
    setSelected(clock?.defaultFont ?? DEFAULT_FONT);
    setFontWeight(clock?.fontWeight ?? 600);
    setLetterSpacing(clock?.letterSpacing ?? 0);
    setOutlineEnabled(clock?.outlineEnabled ?? false);
    setOutlineColor(clock?.outlineColor ?? "#000000");
    setOutlineWidth(clock?.outlineWidth ?? 1);
    setColor(clock?.color ?? "#ffffff");
    setOpacity(clock?.opacity ?? 1);
  }, [config]);

  // Preload fonts for preview whenever the fonts list is available
  useEffect(() => {
    if (!fonts.length) return;
    fonts.forEach((font) => {
      if (font.path) loadFont(font.name, font.path);
    });
  }, [fonts]);

  // Ensure the currently-selected font is loaded (useful after config sets selected)
  useEffect(() => {
    if (!fonts.length) return;
    const match = fonts.find((f) => f.name === selected);
    if (match && match.path) loadFont(match.name, match.path);
  }, [fonts, selected]);

  const updateClockConfig = async (updates: Partial<ClockAppearance>) => {
    const currentAppearance = config?.appearance ?? {};
    const clock = (currentAppearance.clock ?? {}) as ClockAppearance;
    
    const updatedAppearance = {
      ...currentAppearance,
      clock: {
        ...clock,
        ...updates,
      },
    };

    try {
      await updateUserProperty("appearancePreferences", updatedAppearance);
      if (refreshConfig) {
        await refreshConfig();
      }
    } catch (err) {
      console.error("Failed to update appearance config:", err);
    }
  };

  const handleSelect = async (font: FontEntry) => {
    if (font.path) loadFont(font.name, font.path);
    const valueForConfig = font.name === "Default" ? null : font.name;
    setSelected(font.name);
    await updateClockConfig({ defaultFont: valueForConfig });
  };

  if (!fonts.length) {
    return (
      <div className="text-sm text-muted-foreground">
        No fonts found in <code>/public/fonts/index.json</code>
      </div>
    );
  }

  const clockStyle: React.CSSProperties = {
    fontFamily: selected !== "Default" ? `"${selected}", system-ui` : undefined,
    fontWeight: fontWeight,
    letterSpacing: `${letterSpacing}px`,
    color: color,
    opacity: opacity,
  };

  const letterStyle: React.CSSProperties = {
    display: "inline-block",
    position: "relative",
    ...(outlineEnabled ? {
      WebkitTextStroke: `${outlineWidth}px ${outlineColor}`,
      textStroke: `${outlineWidth}px ${outlineColor}`,
    } : {}),
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Font Family</Label>
        <PaginatedCarouselViewComponent minColWidth={180} rowHeight={120} maxRows={1} className="w-full">
          {fonts.map((font) => (
            <button
              key={font.name}
              onClick={() => handleSelect(font)}
              className={`rounded-xl p-4 text-center transition-all border-2 ${selected === font.name
                  ? "border-[var(--primary)] shadow-lg"
                  : "border-transparent hover:border-[var(--primary)]/50 mr-2"
                }`}
            >
              <div
                className="text-4xl leading-none"
                style={{
                  fontFamily: font.name !== "Default" ? `"${font.name}", system-ui` : undefined,
                  fontWeight: fontWeight,
                }}
              >
                12:45
              </div>
              <div className="text-sm mt-2">{font.name}</div>
            </button>
          ))}
        </PaginatedCarouselViewComponent>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 frosted rounded-2xl">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Weight: {fontWeight}</Label>
            </div>
            <Slider 
              value={[fontWeight]} 
              min={100} 
              max={900} 
              step={100} 
              onValueChange={([v]) => {
                setFontWeight(v);
              }}
              onValueCommit={([v]) => updateClockConfig({ fontWeight: v })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Spacing: {letterSpacing}px</Label>
            </div>
            <Slider 
              value={[letterSpacing]} 
              min={-5} 
              max={20} 
              step={0.5} 
              onValueChange={([v]) => setLetterSpacing(v)}
              onValueCommit={([v]) => updateClockConfig({ letterSpacing: v })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Opacity: {Math.round(opacity * 100)}%</Label>
            </div>
            <Slider 
              value={[opacity]} 
              min={0} 
              max={1} 
              step={0.01} 
              onValueChange={([v]) => setOpacity(v)}
              onValueCommit={([v]) => updateClockConfig({ opacity: v })}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Color</Label>
            <Popover>
              <PopoverTrigger asChild>
                <button 
                  className="w-8 h-8 rounded-full border-2 border-white/20" 
                  style={{ backgroundColor: color }}
                />
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3 frosted">
                <ColorPicker value={color} onValueChange={(v) => {
                  setColor(v);
                  updateClockConfig({ color: v });
                }} />
              </PopoverContent>
            </Popover>
          </div>

          <hr className="border-white/10" />

          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Outline</Label>
            <Switch 
              checked={outlineEnabled} 
              onCheckedChange={(v) => {
                setOutlineEnabled(v);
                updateClockConfig({ outlineEnabled: v });
              }} 
            />
          </div>

          {outlineEnabled && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-xs text-muted-foreground">Outline Width: {outlineWidth}px</Label>
                </div>
                <Slider 
                  value={[outlineWidth]} 
                  min={0.5} 
                  max={5} 
                  step={0.1} 
                  onValueChange={([v]) => setOutlineWidth(v)}
                  onValueCommit={([v]) => updateClockConfig({ outlineWidth: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Outline Color</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button 
                      className="w-6 h-6 rounded-full border border-white/20" 
                      style={{ backgroundColor: outlineColor }}
                    />
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-3 frosted">
                    <ColorPicker value={outlineColor} onValueChange={(v) => {
                      setOutlineColor(v);
                      updateClockConfig({ outlineColor: v });
                    }} />
                  </PopoverContent>
                </Popover>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="p-8 flex items-center justify-center bg-black/20 rounded-3xl min-h-[160px]">
        <div style={clockStyle} className="text-7xl">
          {"12:45".split("").map((c, i) => (
            <span key={i} style={c !== ":" ? letterStyle : { margin: "0 4px" }}>
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
