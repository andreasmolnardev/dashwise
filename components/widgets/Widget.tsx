import { useEffect, useState } from "react";

export type WidgetProps = {
    type: string;
    params?: Record<string, any>;
    className?: string;
};

/**
 * Props that actual widgets (Calendar, Weather, etc.) receive.
 * These all share the same shape for strict consistency.
 */
export type WidgetItemProps = {
    className?: string;
    params?: Record<string, any>;
};


export default function WidgetComponent({ type, className, params }: WidgetProps) {
    const [Component, setComponent] = useState<React.FC<WidgetItemProps> | null>(null);

    useEffect(() => {
        let cancelled = false;

        const loadComponent = async () => {
            try {
                let imported: { default: React.FC<WidgetItemProps> } | null = null;

                switch (type) {
                    case "calendar-weekly":
                        imported = await import("./dashboard/Calendar");
                        break;
                    case "calendar-today":
                        imported = await import("./dashboard/Calendar").then((mod) => ({
                            default: mod.CalendarTodayWidget,
                        }));
                        break;
                    case "weather-weekly":
                        imported = await import("./dashboard/Weather");
                        break;
                    case "placeholder":
                        imported = await import("./dashboard/Placeholder");
                        break;
                    default:
                        imported = null;
                }

                if (!cancelled && imported?.default) {
                    setComponent(() => imported!.default);
                }
            } catch (err) {
                console.error("Failed to load widget:", err);
            }
        };

        loadComponent();

        return () => {
            cancelled = true;
        };
    }, [type]);

    if (!Component) {
        return <div className={`widget-default frosted ${className || ""}`}>Go to settings to configure</div>;
    }

    return <Component className={`frosted rounded-lg flex items-center ${className || ""}`} params={params} />;
}
