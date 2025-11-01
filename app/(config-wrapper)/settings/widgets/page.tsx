"use client";
import { useState, useCallback, useEffect } from "react";
import WidgetComponent from "@/components/widgets/Widget";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/context/ConfigContext";

import DashboardPreview from "@/components/settings/widgets/DashboardPreview";
import WidgetCategoryFilters from "@/components/settings/widgets/WidgetCategoryFilters";
import rawWidgetsData from "@/public/widgets.json";

interface Widget {
  id: string;
  type: string;
  properties: Record<string, string>;
}

interface WidgetInfo {
  id?: string;
  slug: string;
  name: string;
  properties?: Record<string, any>;
  description?: string;
  exampleProps?: Record<string, any>;
}

interface DropZones {
  left: Widget[];
  middle: Widget[];
  right: Widget[];
}

interface WidgetsData {
  [category: string]: WidgetInfo[];
}

const widgetsData = rawWidgetsData as unknown as WidgetsData;

function generateWidgetId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export default function WidgetsSettingsPage() {
  const { config, refreshConfig } = useConfig();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [dropZones, setDropZones] = useState<DropZones>({
    left: [],
    middle: [],
    right: []
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedWidget, setSelectedWidget] = useState<WidgetInfo | null>(null);
  const [dropZoneTarget, setDropZoneTarget] = useState<'left' | 'middle' | 'right' | null>(null);
  const [widgetProperties, setWidgetProperties] = useState<Record<string, string>>({});

  // Get available categories based on integrations
  const availableCategories = Object.keys(widgetsData).filter(category => {
    // If category is a built-in one (calendar, placeholders, weather), always show it
    if (['calendar', 'placeholders', 'weather'].includes(category)) return true;
    // Otherwise, check if the integration is enabled
    return config?.integrations?.[category];
  });

  // Load initial widget configuration
  useEffect(() => {
    if (config?.widgets) {
      setDropZones({
        left: config.widgets[0] || [],
        middle: config.widgets[1] || [],
        right: config.widgets[2] || []
      });
    } else {
      // Initialize empty widgets array in config if it doesn't exist
      updateWidgetsConfig([[], [], []]);
    }
  }, [config?.widgets]);

  const updateWidgetsConfig = useCallback(async (zones: Widget[][]) => {
    try {
      const token = localStorage.getItem("pb_token");
      if (!token) throw new Error("Not authenticated");

      // Always ensure we're sending arrays in the correct order [left, middle, right]
      const orderedZones = [
        Array.isArray(zones[0]) ? zones[0] : [],
        Array.isArray(zones[1]) ? zones[1] : [],
        Array.isArray(zones[2]) ? zones[2] : []
      ];

      const response = await fetch('/api/v1/config?path=widgets', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          updatedItem: orderedZones
        })
      });

      if (!response.ok) {
        console.error('Failed to update widgets config');
        return;
      }

      // Refresh config to get the latest changes
      await refreshConfig();
    } catch (error) {
      console.error('Error updating widgets config:', error);
    }
  }, [refreshConfig]);

  const displayedWidgets = selectedCategory
    ? widgetsData[selectedCategory]
    : Object.values(widgetsData).flat();

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold mb-4">Widgets</h1>
      <p>To add them to your dashboard, drag and drop them onto a section</p>

      <DashboardPreview
        leftWidgets={dropZones.left}
        middleWidgets={dropZones.middle}
        rightWidgets={dropZones.right}
        onDropLeft={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('bg-blue-500/10');
          const moveData = e.dataTransfer.getData('moveWidget');

          if (moveData) {
            // Handle widget movement between zones
            const { widget, index, fromZone } = JSON.parse(moveData);
            const newDropZones = { ...dropZones };

            // Remove from original zone
            if (fromZone && fromZone !== 'left') {
              newDropZones[fromZone] = newDropZones[fromZone].filter((_, i) => i !== index);

              // Add to new zone
              newDropZones.left = [...newDropZones.left, widget];

              setDropZones(newDropZones);
              updateWidgetsConfig([newDropZones.left, newDropZones.middle, newDropZones.right]);
            }
          } else {
            // Handle new widget drop
            const widgetData = JSON.parse(e.dataTransfer.getData('widget')) as WidgetInfo;
            if (widgetData.properties) {
              setSelectedWidget(widgetData);
              setDropZoneTarget('left');
              setDialogOpen(true);
            } else {
              const newDropZones = { ...dropZones };
              newDropZones.left = [...newDropZones.left, { id: generateWidgetId(), type: widgetData.slug, properties: {} }];
              setDropZones(newDropZones);
              updateWidgetsConfig([newDropZones.left, newDropZones.middle, newDropZones.right]);
            }
          }
        }}
        onDropMiddle={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('bg-blue-500/10');
          const moveData = e.dataTransfer.getData('moveWidget');

          if (moveData) {
            // Handle widget movement between zones
            const { widget, index, fromZone } = JSON.parse(moveData);
            const newDropZones = { ...dropZones };

            // Remove from original zone
            if (fromZone && fromZone !== 'middle') {
              newDropZones[fromZone] = newDropZones[fromZone].filter((_, i) => i !== index);

              // Add to new zone
              newDropZones.middle = [...newDropZones.middle, widget];

              setDropZones(newDropZones);
              updateWidgetsConfig([newDropZones.left, newDropZones.middle, newDropZones.right]);
            }
          } else {
            // Handle new widget drop
            const widgetData = JSON.parse(e.dataTransfer.getData('widget')) as WidgetInfo;
            if (widgetData.properties) {
              setSelectedWidget(widgetData);
              setDropZoneTarget('middle');
              setDialogOpen(true);
            } else {
              const newDropZones = { ...dropZones };
              newDropZones.middle = [...newDropZones.middle, { id: generateWidgetId(), type: widgetData.slug, properties: {} }];
              setDropZones(newDropZones);
              updateWidgetsConfig([newDropZones.left, newDropZones.middle, newDropZones.right]);
            }
          }
        }}
        onDropRight={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('bg-blue-500/10');
          const moveData = e.dataTransfer.getData('moveWidget');

          if (moveData) {
            // Handle widget movement between zones
            const { widget, index, fromZone } = JSON.parse(moveData);
            const newDropZones = { ...dropZones };

            // Remove from original zone
            if (fromZone && fromZone !== 'right') {
              newDropZones[fromZone] = newDropZones[fromZone].filter((_, i) => i !== index);

              // Add to new zone
              newDropZones.right = [...newDropZones.right, widget];

              setDropZones(newDropZones);
              updateWidgetsConfig([newDropZones.left, newDropZones.middle, newDropZones.right]);
            }
          } else {
            // Handle new widget drop
            const widgetData = JSON.parse(e.dataTransfer.getData('widget')) as WidgetInfo;
            if (widgetData.properties) {
              setSelectedWidget(widgetData);
              setDropZoneTarget('right');
              setDialogOpen(true);
            } else {
              const newDropZones = { ...dropZones };
              newDropZones.right = [...newDropZones.right, { id: generateWidgetId(), type: widgetData.slug, properties: {} }];
              setDropZones(newDropZones);
              updateWidgetsConfig([newDropZones.left, newDropZones.middle, newDropZones.right]);
            }
          }
        }}
        onWidgetEdit={(widget: Widget, index: number, zone: 'left' | 'middle' | 'right') => {
          const widgetInfo = Object.values(widgetsData)
            .flat()
            .find(w => w.slug === widget.type);
          if (widgetInfo) {
            setSelectedWidget({ ...widgetInfo, id: widget.id, properties: widget.properties });
            setDropZoneTarget(zone);
            setWidgetProperties(widget.properties);
            setDialogOpen(true);
          }
        }}
        onWidgetRemove={(index: number, zone: 'left' | 'middle' | 'right') => {
          const newDropZones = { ...dropZones };
          newDropZones[zone] = newDropZones[zone].filter((_, i) => i !== index);
          setDropZones(newDropZones);
          updateWidgetsConfig([newDropZones.left, newDropZones.middle, newDropZones.right]);
        }}
      />

      <WidgetCategoryFilters
        categories={availableCategories}
        selectedCategory={selectedCategory}
        onCategorySelect={setSelectedCategory}
      />

      <ul
        className="grid gap-4 overflow-y-hidden overflow-x-scroll"
        style={{
          gridTemplateColumns: `repeat(${displayedWidgets.length}, 220px)`,
          gridTemplateRows: `90px`,
        }}
      >
        {displayedWidgets.map((widget) => (
          <div
            key={widget.slug}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('widget', JSON.stringify(widget));
            }}
          >
            <div className="flex flex-col items-center gap-2">
              <WidgetComponent
                type={widget.slug}
                className="h-[90px] w-full"
                params={widget.exampleProps || {}}
              />
              <span className="text-sm">{widget.name}</span>
            </div>
          </div>
        ))}
      </ul>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="frosted text-(--text-primary)">
          <DialogHeader>
            <DialogTitle>Configure Widget</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {selectedWidget && selectedWidget.properties && (
              Object.entries(selectedWidget.properties).map(([key, type]) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={key}>{key}</Label>
                  <Input
                    id={key}
                    value={widgetProperties[key] || ''}
                    onChange={(e) => setWidgetProperties(prev => ({
                      ...prev,
                      [key]: e.target.value
                    }))}
                  />
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              if (dropZoneTarget && selectedWidget) {
                const newDropZones = { ...dropZones };
                // If editing an existing widget, update it
                if (selectedWidget.id) {
                  newDropZones[dropZoneTarget] = newDropZones[dropZoneTarget].map(w =>
                    w.id === selectedWidget.id
                      ? { ...w, properties: widgetProperties }
                      : w
                  );
                } else {
                  // Adding a new widget
                  const widget = {
                    id: generateWidgetId(),
                    type: selectedWidget.slug,
                    properties: selectedWidget.properties ? widgetProperties : {}
                  };
                  newDropZones[dropZoneTarget] = [
                    ...newDropZones[dropZoneTarget],
                    widget
                  ];
                }

                setDropZones(newDropZones);
                updateWidgetsConfig([newDropZones.left, newDropZones.middle, newDropZones.right]);

                setDialogOpen(false);
                setWidgetProperties({});
                setSelectedWidget(null);
                setDropZoneTarget(null);
              }
            }}>Add Widget</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}