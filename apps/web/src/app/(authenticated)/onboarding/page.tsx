
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePageConfig } from "@/src/hooks/usePageConfig";
import useAuth from "@/src/context/useAuth";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ThemeSelectComponent from "@/components/settings/ThemeSelect";
import UploadWallpaperDialogComponent from "@/components/settings/UploadWallpaperDialog";
import UrlWallpaperDialogComponent from "@/components/settings/UrlWallpaperDialog";
import { updateConfigPathAction } from "@/app/actions/config";

type TimeFormatValue = "24-hour" | "12-hour";

function normalizeTimeFormat(value: unknown): TimeFormatValue {
  if (value === "12-hour" || value === "12h" || value === 12 || value === "12") {
    return "12-hour";
  }
  return "24-hour";
}

const DATE_FORMAT_OPTIONS = [
  "DD-MM-YYYY",
  "MM-DD-YYYY",
  "YYYY-MM-DD",
  "ddd DD-MM-YYYY",
] as const;

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { config, patchConfig } = usePageConfig();
  const { withAuth } = useAuth();

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);

  const globalConfig = config?.global ?? {};
  const timeFormat = useMemo(
    () => normalizeTimeFormat(globalConfig?.timeFormat ?? globalConfig?.["time-format"]),
    [globalConfig?.timeFormat, globalConfig?.["time-format"]]
  );
  const dateFormat = globalConfig?.dateFormat ?? "DD-MM-YYYY";
  const weatherUnit = globalConfig?.weatherUnit ?? "c";

  useEffect(() => {
    if (config?.meta?.onboard === false) {
      navigate("/home", { replace: true });
    }
  }, [config?.meta?.onboard, navigate]);

  async function updateGlobal(patch: Record<string, any>) {
    const nextGlobal = {
      ...globalConfig,
      ...patch,
    };

    patchConfig((prev) => ({
      ...prev,
      global: nextGlobal,
    }));

    await withAuth((auth) => updateConfigPathAction(auth, "global", nextGlobal, "home"));
  }

  async function finishOnboarding() {
    setBusy(true);
    try {
      const nextMeta = {
        ...(config?.meta ?? {}),
        onboard: false,
      };

      patchConfig((prev) => ({
        ...prev,
        meta: nextMeta,
      }));

      await withAuth((auth) => updateConfigPathAction(auth, "meta", nextMeta, "home"));
      navigate("/home", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh p-4 md:p-8 text-(--surface-foreground) bg-(--surface)">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="frosted rounded-xl p-5 md:p-6 space-y-4">
          <h1 className="text-3xl font-semibold">Welcome to dashwise</h1>

          <div className="flex items-center gap-2">
            {[0, 1].map((index) => (
              <span
                key={index}
                className={`h-2.5 w-2.5 rounded-full ${step === index ? "bg-(--primary)" : "bg-white/30"}`}
              />
            ))}
          </div>

          {step === 0 ? (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Localization</h2>

              <div className="frosted rounded-md p-3 flex items-center justify-between gap-3">
                <p className="font-medium">Time format</p>
                <Select
                  value={timeFormat}
                  onValueChange={(value) => {
                    const next = value as TimeFormatValue;
                    const legacy = next === "12-hour" ? "12h" : "24h";
                    updateGlobal({ timeFormat: next, "time-format": legacy });
                  }}
                >
                  <SelectTrigger className="w-44 frosted">
                    <SelectValue placeholder="Select time format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24-hour">24-hour</SelectItem>
                    <SelectItem value="12-hour">12-hour</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="frosted rounded-md p-3 flex items-center justify-between gap-3">
                <p className="font-medium">Date format</p>
                <Select
                  value={dateFormat}
                  onValueChange={(value) => updateGlobal({ dateFormat: value })}
                >
                  <SelectTrigger className="w-52 frosted">
                    <SelectValue placeholder="Select date format" />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_FORMAT_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="frosted rounded-md p-3 flex items-center justify-between gap-3">
                <p className="font-medium">Temperature unit</p>
                <div className="flex gap-2 frosted rounded-full text-(--text-on-frosted) px-2 py-1">
                  <button
                    onClick={() => updateGlobal({ weatherUnit: "c" })}
                    className={`rounded-full px-2 py-1 ${weatherUnit === "c" ? "bg-white/20" : ""}`}
                  >
                    °C
                  </button>
                  <button
                    onClick={() => updateGlobal({ weatherUnit: "f" })}
                    className={`rounded-full px-2 py-1 ${weatherUnit === "f" ? "bg-white/20" : ""}`}
                  >
                    °F
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Make it yours</h2>
              <p className="text-sm text-muted-foreground">Customize dashwise</p>

              <h3 className="text-lg font-bold">Wallpaper</h3>
              <div className="flex flex-wrap gap-2 items-center  justify-center">
                <Button variant="outline" className="rounded-full" onClick={() => setUploadDialogOpen(true)}>
                  Upload wallpaper
                </Button>
                <Button variant="outline" className="rounded-full" onClick={() => setUrlDialogOpen(true)}>
                  Set wallpaper URL
                </Button>
              </div>

              <h3 className="text-lg font-bold">Theme</h3>
              <ThemeSelectComponent className="frosted rounded-md p-3 space-y-4" />
            </div>
          )}

          <div className="pt-2 flex items-center justify-between gap-2">
            <Button variant="ghost" disabled={busy} onClick={finishOnboarding}>Skip</Button>

            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button variant="outline" onClick={() => setStep(step - 1)}>
                  Back
                </Button>
              )}

              {step < 1 ? (
                <Button onClick={() => setStep(step + 1)}>Next</Button>
              ) : (
                <Button disabled={busy} onClick={finishOnboarding}>
                  {busy ? "Saving..." : "Finish"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <UploadWallpaperDialogComponent open={uploadDialogOpen} onOpenChange={setUploadDialogOpen} />
      <UrlWallpaperDialogComponent open={urlDialogOpen} onOpenChange={setUrlDialogOpen} configKey="appearance" />
    </div>
  );
}
