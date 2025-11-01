import { getWeatherIcon } from "@/components/glanceables/Glanceable";
import { useEffect, useState } from "react";

interface WeatherWidgetProps {
  className?: string;
  params: {
    locationCoordinates: string;
    locationDisplayname?: string;
    unit?: string;
    showLocation?: boolean;
  };
}

interface WeatherData {
  temperature: string;
  description: string;
  iconUrl: string;
  unit: string;
  tonight?: {
    temperature: string;
    description: string;
    iconUrl: string;
  };
  tomorrow?: {
    temperature: string;
    description: string;
    iconUrl: string;
  };
  error?: string;
}

export default function WeatherWidget({ className, params }: WeatherWidgetProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWeather = async () => {
      const [lat, lon] = params.locationCoordinates.split(",").map((s) => s.trim());
      const unit = params.unit || "c";

      try {
        const res = await fetch(`/api/v1/weather?lat=${lat}&lon=${lon}&unit=${unit}`);
        const data = await res.json();
        setWeather(data);
      } catch (err) {
        setWeather({ error: "Failed to fetch weather data" } as WeatherData);
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();
  }, [params]);

  if (loading) return <div className={className}>Loading weather...</div>;
  if (!weather || weather.error) return <div className={className}>Error: {weather?.error}</div>;

  const columns = [
    { label: "Now", data: weather },
    { label: "Tonight", data: weather.tonight },
    { label: "Tomorrow", data: weather.tomorrow },
  ];

  return (
    <div className={`${className} gap-2 flex-col justify-center`}>
      {params.showLocation && <h3 className="w-full text-center text-sm">{params.locationDisplayname}</h3>}

      <div className="grid grid-cols-3 gap-2 w-full">
        {columns.map(
          (col, idx) =>
            col.data && (
              <div key={idx} className="flex flex-col items-center text-center text-xs">
                <strong className="text-sm">{col.label}</strong>
                <div className="text-xl my-1">
                  {getWeatherIcon(col.data.description, col.data.iconUrl)} {/* optionally pass smaller size */}
                </div>
                <div>
                  {col.data.temperature}
                  {weather.unit} - {col.data.description}
                </div>
              </div>
            )
        )}
      </div>
    </div>
  );
}
