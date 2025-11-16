"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/context/ConfigContext";

type Integration = {
  name: string;
  description: string;
  properties?: Record<string, string>; // e.g. { api_token: "as:string" }
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

  async function updateIntegration(name: string, props: Record<string, string> = {}) {
    const updatedItem = { ...activeIntegrations, [name]: props };
    setActiveIntegrations(updatedItem);

    try {
      await fetch(`/api/v1/config?path=integrations.${name}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("pb_token")}`,
        },
        body: JSON.stringify({ updatedItem: props }),
      });
    } catch (err) {
      console.error("Failed to update config:", err);
    }
  }


  function toggleIntegration(integration: Integration) {
    if (activeIntegrations[integration.name]) {
      // Disable
      const updated = { ...activeIntegrations };
      delete updated[integration.name];
      setActiveIntegrations(updated);
      updateIntegration(integration.name, {}); // Empty disables
    } else if (integration.properties) {
      // Enable with dialog
      setPendingIntegration(integration);
      setPendingProps({});
      setDialogOpen(true);
    } else {
      // Enable directly with empty props
      updateIntegration(integration.name, {});
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
                      <h3 className="text-lg font-medium">
                        {integration.name}
                      </h3>
                      <p className="text-sm text-gray-100">
                        {integration.description}
                      </p>
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

      {/* Enable dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="frosted text-(--text-primary)">
          <DialogHeader>
            <DialogTitle>
              Enable {pendingIntegration?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {pendingIntegration?.properties &&
              Object.entries(pendingIntegration.properties).map(
                ([propName, propType]) => (
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
                )
              )}
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
