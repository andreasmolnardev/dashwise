import https from 'https';

export default async function getDashdotMetrics({
  serverUrl,
  allowInsecureCerts = false,
}: {
  serverUrl: string;
  allowInsecureCerts?: boolean;
}) {
  const baseUrl = serverUrl.replace(/\/$/, '');
  const agent = allowInsecureCerts ? new https.Agent({ rejectUnauthorized: false }) : undefined;

  const fetchJson = async (path: string) => {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...(agent ? { agent } : {}),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  // --- fetch main info ---
  const info = await fetchJson('/info');
  if (!info) throw new Error('Dashdot /info request failed');

  // --- fetch load details ---
  const load = {
    cpu: await fetchJson('/load/cpu'),
    ram: await fetchJson('/load/ram'),
    storage: await fetchJson('/load/storage'),
    network: await fetchJson('/load/network'),
    gpu: await fetchJson('/load/gpu'),
  };

  // --- normalize and merge ---
  return {
    hostname: info?.hostname,
    os: info?.os,
    cpu: {
      cores: info?.cpu?.cores,
      usage: info?.cpu?.usage,
      temperature: info?.cpu?.temperature,
      load: load.cpu ?? null,
    },
    memory: {
      total: info?.ram?.total,
      used: info?.ram?.used,
      load: load.ram ?? null,
    },
    storage: (info?.storage ?? []).map((disk: any, i: number) => ({
      name: disk?.name,
      total: disk?.size,
      used: disk?.used,
      load: load.storage?.[i] ?? null,
    })),
    network: {
      up: info?.network?.speed_up,
      down: info?.network?.speed_down,
      load: load.network ?? null,
    },
    gpu: {
      ...info?.gpu,
      load: load.gpu ?? null,
    },
  };
}
