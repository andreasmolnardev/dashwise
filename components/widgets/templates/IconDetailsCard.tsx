
export default function IconDetailsCard(
  properties: Record<string, unknown>,
  className?: string,
) {
  const icon = getImageUrl(properties.icon) || getImageUrl(properties.image) || getImageUrl(properties.leftIcon);
  const primary = getPreviewText(properties.primary) || "Weather";
  const secondary = getPreviewText(properties.secondary);

  return (
    <div className={`frosted rounded-lg p-3 ${className || ""}`}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] grid-rows-2 items-center gap-x-3 gap-y-1">
        <div className="row-span-2 flex h-12 w-12 items-center justify-center rounded-lg bg-black/10">
          {icon ? (
            <img src={icon} className="h-9 w-9 object-contain" alt="" />
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold leading-tight">{primary}</p>
        </div>
        <div className="min-w-0">
          {secondary ? (
            <p className="truncate text-sm text-white/75 leading-tight">{secondary}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}