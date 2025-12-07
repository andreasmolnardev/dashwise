"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/context/ConfigContext";
import { writeToConfig } from "@/lib/frontend/data/write";

type Integration = {
  name: string;
  description: string;
  properties?: Record<string, string>;
  page?: string;
};

export default function IntegrationsSettingsPage() {
  const { config } = useConfig();
  const [groups, setGroups] = useState<Record<string, Integration[]>>({});
  const [activeIntegrations, setActiveIntegrations] = useState<
    Record<string, Record<string, string>>
  >(config.integrations || {});

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingIntegration, setPendingIntegration] = useState<Integration | null>(null);
  const [pendingProps, setPendingProps] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/integrations.json")
      .then((res) => res.json())
      .then((data) => setGroups(data))
      .catch((err) => console.error("Failed to load integrations:", err));
  }, []);

  async function updateIntegration(name: string, props: Record<string, string>) {
    const updated = { ...activeIntegrations, [name]: props };
    setActiveIntegrations(updated);

    try {
      await writeToConfig(`integrations.${name}`, props);
    } catch (err) {
      console.error("Failed to update integration config:", err);
    }
  }

  async function updatePages(pages: string[]) {
    try {
      await writeToConfig("pages", pages);
    } catch (err) {
      console.error("Failed to update pages config:", err);
    }
  }

  function toggleIntegration(integration: Integration) {
    const isEnabled = Boolean(activeIntegrations[integration.name]);

    // DISABLE
    if (isEnabled) {
      const updated = { ...activeIntegrations };
      delete updated[integration.name];
      setActiveIntegrations(updated);
      updateIntegration(integration.name, {});

      if (integration.page) {
        const currentPages = config.pages || [];
        const newPages = currentPages.filter((p) => p !== integration.page);
        updatePages(newPages);
      }

      return;
    }

    // ENABLE (needs user props)
    if (integration.properties) {
      setPendingIntegration(integration);
      setPendingProps({});
      setDialogOpen(true);
      return;
    }

    // ENABLE directly (no props)
    updateIntegration(integration.name, {});

    if (integration.page) {
      const currentPages = config.pages || [];
      const combined = Array.from(new Set([...currentPages, integration.page]));
      updatePages(combined);
    }
  }

  function handleDialogConfirm() {
    if (!pendingIntegration) return;

    const encodedProps = Object.fromEntries(
      Object.entries(pendingProps).map(([k, v]) => [
        k,
        pendingIntegration.properties?.[k] === "as:string" ? btoa(v) : v,
      ])
    );

    updateIntegration(pendingIntegration.name, encodedProps);

    if (pendingIntegration.page) {
      const currentPages = config.pages || [];
      const combined = Array.from(new Set([...currentPages, pendingIntegration.page]));
      updatePages(combined);
    }

    setDialogOpen(false);
    setPendingIntegration(null);
  }

  return (
    <>
      <h1 className="text-3xl font-semibold mb-6">Integrations</h1>

      <div className="space-y-8">
        {Object.entries(groups).map(([groupName, integrations]) => (
          <div key={groupName}>
            <h2 className="text-xl font-semibold mb-4">
              {groupName.charAt(0).toUpperCase() + groupName.slice(1)}
            </h2>

            <div className="grid gap-4">
              {integrations.map((integration) => (
                <div
                  key={integration.name}
                  className="frosted rounded-2xl p-4 flex flex-col gap-4"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-medium">{integration.name}</h3>
                      <p className="text-sm text-gray-100">{integration.description}</p>
                    </div>
                    <Switch
                      checked={!!activeIntegrations[integration.name]}
                      onCheckedChange={() => toggleIntegration(integration)}
                      className="[&>span]:bg-white [&>span[data-state=checked]]:bg-white"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="frosted text-(--text-primary)">
          <DialogHeader>
            <DialogTitle>Enable {pendingIntegration?.name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {pendingIntegration?.properties &&
              Object.entries(pendingIntegration.properties).map(([propName]) => (
                <input
                  key={propName}
                  type="text"
                  placeholder={propName}
                  value={pendingProps[propName] || ""}
                  onChange={(e) =>
                    setPendingProps((prev) => ({
                      ...prev,
                      [propName]: e.target.value,
                    }))
                  }
                  className="rounded-md p-2 text-black w-full frosted"
                />
              ))}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleDialogConfirm}>Enable</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
