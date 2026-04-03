"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@iconify-icon/react";
import { getAppInfoAction } from "@/app/actions/app";
import useAuth from "@/src/context/useAuth";

export default function UpdateDetailsDialogComponent() {
  const { withAuth } = useAuth();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("");
  const [newVersion, setNewVersion] = useState("");

  useEffect(() => {
    async function fetchUpdateInfo() {
      try {
        const data = await withAuth((auth) => getAppInfoAction(auth));

        if (data.updateAvailable != "0") {
          setUpdateAvailable(true);
          setCurrentVersion(data.currentAppVersion);
          setNewVersion(data.updateAvailable ?? "unknown");
        }
      } catch (err) {
        console.error("Update check failed:", err);
      }
    }

    fetchUpdateInfo();
  }, [withAuth]);

  if (!updateAvailable) return null; // only show if update exists

  return (
    <Dialog>
      <DialogTrigger asChild>
        <div className="frosted aspect-square rounded-full p-1 group flex items-center justify-center cursor-pointer">
          <Icon
            icon="fa6-solid:arrows-rotate"
            className="text-sm group-hover:text-(--primary) transition-colors duration-200"
          />
        </div>
      </DialogTrigger>

      <DialogContent className="frosted text-foreground">
        <DialogTitle>Update Available</DialogTitle>
        <div className="space-y-2 mt-2">
          <p>Current version: <strong>{currentVersion}</strong></p>
          <p>New version: <strong>{newVersion}</strong></p>
          <Button
            asChild
            className="mt-3"
          >
            <a
              href="https://github.com/andreasmolnardev/dashwise-next/releases"
              target="_blank"
              rel="noopener noreferrer"
            >
              View Changelog on GitHub
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
