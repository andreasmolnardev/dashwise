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

  // fetch info endpointm then load details
  const info = await fetchJson('/info');
  if (!info) throw new Error('Dashdot /info request failed');

  const load = {
    cpu: await fetchJson('/load/cpu'),
    ram: await fetchJson('/load/ram'),
    storage: await fetchJson('/load/storage'),
    network: await fetchJson('/load/network'),
    gpu: await fetchJson('/load/gpu'),
  };

  const storage = Array.isArray(info?.storage) ? (info.storage as any[]).map((store, i) => {
    const total = typeof store?.size === 'number' ? store.size : (Number(store?.size) || null);
    
    const usedAmount = load.storage[i];
    let usedPercentage: number | null = null;
    if (typeof total === 'number' && total > 0 && typeof usedAmount === 'number' && !Number.isNaN(usedAmount)) {
      usedPercentage = Math.min(100, Math.max(0, Number(((usedAmount / total) * 100).toFixed(2))));
    }

    const disks = Array.isArray(store?.disks)
      ? store.disks.map((d: any) => ({
        device: d?.device ?? null,
        brand: d?.brand ?? null,
        type: d?.type ?? null,
      }))
      : [];

    return {
      total,
      usedAmount,
      usedPercentage,
      disks,
      load: Array.isArray(load.storage) ? load.storage[i] ?? null : null,
    };
  }) : [];

  return {
    hostname: info?.hostname,
    os: info?.os,
    cpu: {
      cores: info?.cpu?.cores,
      usage: info?.cpu?.usage,
      temperature: info?.cpu?.temperature,
      load: load.cpu,
    },
    memory: {
      total: info?.ram?.size,
      used: info?.ram?.used,
      load: load.ram?.load,
    },
    storage,
    network: {
      up: info?.network?.speed_up,
      down: info?.network?.speed_down,
      load: load.network,
    },
    gpu: {
      ...info?.gpu,
      load: load.gpu,
    },
  };
}