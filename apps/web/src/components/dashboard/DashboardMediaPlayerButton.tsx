import { AudioLines, Music2, Pause, Play, SkipBack, SkipForward, Volume2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMediaPlayer } from "@/context/MediaPlayerContext";

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function DashboardMediaPlayerButton() {
  const {
    current,
    upcoming,
    isPlaying,
    currentTime,
    duration,
    volume,
    toggle,
    seek,
    setVolume,
    next,
    previous,
    playQueued,
    removeFromQueue,
    clearQueue,
    clear,
  } = useMediaPlayer();

  const trackTitle = current?.source?.metadata?.title
    ?? (current?.request.type === "resource" ? current.request.resource.resourceId : current ? "Media" : "");
  const totalDuration = duration || current?.source?.metadata?.durationSeconds || 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Media player"
          title="Media player"
          className="frosted aspect-square rounded-full p-2.5 text-white"
        >
          <AudioLines className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" sideOffset={10} className="frosted w-[min(22rem,calc(100vw-2rem))] border-white/20 bg-black/55 p-4 text-white shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Music2 className="size-4 shrink-0 text-white/75" />
            <h2 className="truncate text-sm font-semibold text-white">{current ? "Now playing" : "Media player"}</h2>
          </div>
          {current && (
            <Button type="button" variant="ghost" size="icon" aria-label="Clear playback" onClick={clear} className="size-8">
              <X className="size-4" />
            </Button>
          )}
        </div>

        {!current ? (
          <p className="py-4 text-center text-sm text-white/75">Nothing playing</p>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-3">
              {current.source?.metadata?.artworkUrl
                ? <img src={current.source.metadata.artworkUrl} alt="" className="size-12 shrink-0 rounded-md object-cover" />
                : <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-white/10"><Music2 className="size-5" /></div>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{trackTitle}</div>
                {current.source?.metadata?.artist && <div className="truncate text-xs text-white/65">{current.source.metadata.artist}</div>}
                {current.loading && <div className="text-xs text-white/65">Resolving media…</div>}
                {current.error && <div role="alert" className="mt-1 text-xs text-destructive">{current.error}</div>}
              </div>
            </div>

            {current.source && !current.loading && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-[10px] tabular-nums text-white/65">{formatTime(currentTime)}</span>
                <input
                  aria-label="Seek"
                  type="range"
                  min={0}
                  max={totalDuration}
                  step={1}
                  value={Math.min(currentTime, totalDuration || currentTime)}
                  onChange={(event) => seek(Number(event.target.value))}
                  className="h-1 min-w-12 flex-1 accent-sky-400"
                />
                <span className="text-[10px] tabular-nums text-white/65">{formatTime(totalDuration)}</span>
              </div>
            )}

            <div className="mt-3 flex items-center justify-center gap-2">
              <Button type="button" variant="ghost" size="icon" aria-label="Previous" disabled={!current.source || current.loading} onClick={previous}>
                <SkipBack className="size-4" />
              </Button>
              <Button type="button" variant="secondary" size="icon" aria-label={isPlaying ? "Pause" : "Play"} disabled={!current.source || current.loading} onClick={toggle}>
                {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Next" disabled={upcoming.length === 0} onClick={next}>
                <SkipForward className="size-4" />
              </Button>
              <label className="ml-2 flex items-center gap-2" aria-label="Volume">
                <Volume2 className="size-4" />
                <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="w-20 accent-sky-400" />
              </label>
            </div>

            {upcoming.length > 0 && (
              <div className="mt-4 border-t border-white/10 pt-3">
                <div className="mb-2 flex items-center justify-between text-xs text-white/65">
                  <span>Up next ({upcoming.length})</span>
                  <button type="button" onClick={clearQueue} className="hover:text-foreground">Clear queue</button>
                </div>
                <ol className="max-h-36 space-y-1 overflow-y-auto">
                  {upcoming.map((item, index) => {
                    const label = item.type === "resource"
                      ? item.metadata?.title ?? item.resource.resourceId
                      : item.source.metadata?.title ?? item.source.url;
                    return (
                      <li key={`${label}:${index}`} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-white/10">
                        <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => playQueued(index)}>{label}</button>
                        <button type="button" aria-label={`Remove ${label} from queue`} onClick={() => removeFromQueue(index)} className="text-white/65 hover:text-white">×</button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
