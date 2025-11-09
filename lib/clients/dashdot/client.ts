export default async function getDashdotMetrics({
  serverUrl,
  allowInsecureCerts = false,
}: {
  serverUrl: string;
  allowInsecureCerts?: boolean;
}) {
  const url = `${serverUrl.replace(/\/$/, '')}/info`;

  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    // support for self-signed TLS
    ...(allowInsecureCerts ? { agent: new (require('https').Agent)({ rejectUnauthorized: false }) } : {}),
  });

  if (!res.ok) {
    throw new Error(`Dashdot request failed (${res.status})`);
  }

  const data = await res.json();

  // data normalization
  return {
    hostname: data?.hostname,
    os: data?.os,
    cpu: {
      cores: data?.cpu?.cores,
      usage: data?.cpu?.usage,
      temperature: data?.cpu?.temperature,
    },
    memory: {
      total: data?.ram?.total,
      used: data?.ram?.used,
    },
    storage: data?.storage?.map((disk: any) => ({
      name: disk?.name,
      total: disk?.size,
      used: disk?.used,
    })),
    network: {
      up: data?.network?.speed_up,
      down: data?.network?.speed_down,
    },
    gpu: data?.gpu,
  };
}
