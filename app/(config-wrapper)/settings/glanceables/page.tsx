"use client";
import { useEffect, useState } from "react";
import GlanceableComponent from "@/components/glanceables/Glanceable";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PaginatedCarouselViewComponent } from "@/components/widgets/PaginatedCarouselView";
import { useConfig } from "@/context/ConfigContext";
import { Label } from "@radix-ui/react-label";
import GlanceablePropertiesSettingsComponent from "@/components/settings/GlanceablePropertiesSettings";

type Glanceable = {
  type: string;
  displayName: string;
  description: string;
  example?: string;
  exampleProps?: Record<string, any>;
  properties?: Record<string, string>;
};


export default function GlanceablesSettingsPage() {
  const { config } = useConfig();
  const [currentTab, setCurrentTab] = useState<"left" | "right">("left");
  const [glanceables, setGlanceables] = useState<Glanceable[]>([]);
  const [selectedGlanceable, setSelectedGlanceable] = useState<string>("current");

  useEffect(() => {
    fetch("/glanceables.json")
      .then((res) => res.json() as Promise<Record<string, Omit<Glanceable, "type">>>)
      .then((data) => {
        const list: Glanceable[] = Object.entries(data).map(([type, value]) => ({
          type,
          ...value,
        } as Glanceable));
        setGlanceables(list);
      });
  }, []);

  const currentGlanceable =
    currentTab === "left" ? config.glanceables[0] : config.glanceables[1];

  const selected =
  selectedGlanceable === "current"
    ? { ...currentGlanceable, isCurrent: true }
    : { ...(glanceables.find((g) => g.type === selectedGlanceable) ?? {}) };

  return (
    <>
      <h1 className="text-3xl font-semibold mb-4">Glanceables</h1>

      <Tabs
        value={currentTab}
        onValueChange={(val) => setCurrentTab(val as "left" | "right")}
        className="w-full  flex items-center my-4"
      >
        <TabsList className="frosted rounded-full gap-2 text-white/20">
          <TabsTrigger value="left" className="data-[state=active]:bg-white/20 rounded-full"><span className="text-(--text-primary)">Left one</span></TabsTrigger>
          <TabsTrigger value="right" className="data-[state=active]:bg-white/20 rounded-full"><span className="text-(--text-primary)">Right one</span></TabsTrigger>
        </TabsList>
      </Tabs>

      <section className="grid grid-cols-[3fr_2fr]">
        <RadioGroup
          value={selectedGlanceable}
          onValueChange={setSelectedGlanceable}
          asChild>
          <PaginatedCarouselViewComponent minCols={2}>
            <Label className="grid grid-rows-[2fr_1fr] justify-center items-center gap-1">
              <GlanceableComponent type={currentGlanceable.type} params={currentGlanceable.properties} className="frosted px-2 py-0.5 h-8 rounded-full" />
              <RadioGroupItem
                value="current"
                id="glanceables-current"
                className="hidden data-[state=checked]:[&+p]:text-(--primary)"
              />
              <p className="text-sm text-center">Current</p>
            </Label>
            {glanceables.map((glanceable) => (
              <Label
                key={glanceable.type}
                className="grid grid-rows-[2fr_1fr] justify-center items-center gap-1"
              >
                <GlanceableComponent
                  type={glanceable.type}
                  params={glanceable.exampleProps || {}}
                  className="frosted px-2 py-0.5 h-8 rounded-full"
                />
                <RadioGroupItem
                  value={glanceable.type}
                  id={`glanceables-${glanceable.type}`}
                  className="hidden data-[state=checked]:[&+p]:text-(--primary)"
                />
                <p className="text-sm text-center">
                  {glanceable.displayName}
                </p>
              </Label>
            ))}
          </PaginatedCarouselViewComponent>
        </RadioGroup>

        <GlanceablePropertiesSettingsComponent selected={selected} currentTab={currentTab} isCurrent={(selectedGlanceable === "current") ? true : false}/>
      </section>
    </>
  );
}
