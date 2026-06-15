export async function getLocations(q?: string | null) {
  if (!q) return [];

  const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6`;

  const response = await fetch(nominatimUrl, {
    headers: { "User-Agent": "my-homelab-dashboard/1.0" },
  });

  return response.json();
}
