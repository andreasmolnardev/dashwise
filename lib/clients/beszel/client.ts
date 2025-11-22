import https from "https"
import axios from "axios"
import { URLSearchParams } from "url"

//authenticate to beszel pocketbase backend
async function createToken({
    url,
    pb_email,
    pb_password,
    allowInsecureCerts = false,
}: {
    url: string
    pb_email: string
    pb_password: string
    allowInsecureCerts?: boolean
}) {
    const endpoint = `${url}/api/collections/_superusers/auth-with-password`

    try {
        const res = await axios.post(
            endpoint,
            { identity: pb_email, password: pb_password },
            {
                headers: { "Content-Type": "application/json" },
                httpsAgent: allowInsecureCerts
                    ? new https.Agent({ rejectUnauthorized: false })
                    : undefined,
            }
        )

        return {
            token: res.data?.token,
            userId: res.data?.record?.id,
        }
    } catch (err) {
        if (axios.isAxiosError(err)) {
            console.error("[Beszel] Authentication failed:", {
                status: err.response?.status,
                data: err.response?.data,
                message: err.message,
            })
        } else {
            console.error("[Beszel] Unexpected error:", err)
        }
        throw new Error("Authentication failed")
    }
}

// fetch system list
async function fetchSystems(url: string, token: string, allowInsecureCerts: boolean) {
    const res = await axios.get(`${url}/api/collections/systems/records`, {
        headers: { Authorization: `Bearer ${token}` },
        httpsAgent: allowInsecureCerts ? new https.Agent({ rejectUnauthorized: false }) : undefined,
    })
    return res.data?.items || []
}

// normalize to expected output
function normalizeSystemRecord(record: any) {
    const info = record.info || {}
    return {
        details: {
            hostname: record.name || info.h || "unknown",
            status: record.status || "unknown",
            os_kernel: info.k || null,
            cpu_model: info.m || null,
            cpu_cores: info.c || null,
            cpu_usage_percent: info.cpu ?? null,
            memory_total_mb: info.mb ?? null,
            memory_used_percent: info.mp ?? null,
            disk_total_gb: info.dt ?? null,
            disk_used_percent: info.dp ?? null,
            boot_time_seconds: info.bb ?? null,
            uptime_seconds: info.u ?? null,
            temperature_c: info.t ?? null,
            version: info.v || null
        },
        load: {
            "1m": info.l1 ?? null,
            "5m": info.l5 ?? null,
            "15m": info.l15 ?? null,
        },
        network: {
            bytes_sent: info.b ?? null,
            bytes_received: info.bb ?? null,
            interfaces: info.efs ?? null,
        },
    }
}

//Fetch individual system stats
async function fetchSystemStatsForSystem(
    systemId: string,
    {
        url,
        token,
        allowInsecureCerts = false,
    }: {
        url: string
        token: string
        allowInsecureCerts?: boolean
    }
) {
    const params = new URLSearchParams()
    params.append('filter', `(system='${systemId}')`)
    params.append('sort', 'created') 
    params.append('perPage', '500') 

    const endpoint = `${url}/api/collections/system_stats/records?${params.toString()}`

    let res
    try {
        res = await axios.get(endpoint, {
            headers: { Authorization: `Bearer ${token}` },
            httpsAgent: allowInsecureCerts ? new https.Agent({ rejectUnauthorized: false }) : undefined,
        })
    } catch (err) {
        if (axios.isAxiosError(err)) {
            console.error(`[Beszel] Fetching stats for system ${systemId} failed:`, {
                status: err.response?.status,
                data: err.response?.data,
            })
        } else {
            console.error(`[Beszel] Unexpected error fetching stats for ${systemId}:`, err)
        }
    
        return {
            load: {
                "1m": null,
                "10min": null,
                "20min": null,
                "120min": null,
                "480min": null,
            },
            average_total_memory_mb_rounded: null
        }
    }

    const items = res.data?.items

    // Handle empty response
    if (!items || items.length === 0) {
        return {
            load: {
                "1m": null,
                "10min": null,
                "20min": null,
                "120min": null,
                "480min": null,
            },
            average_total_memory_mb_rounded: null,
        }
    }

    // --- 1. Calculate Average Total RAM ---
    // `stats.m` appears to be total memory in GiB (e.g., 15.84)
    const totalRamSum = items.reduce((sum: number, item: any) => {
        return sum + (item.stats?.m || 0)
    }, 0)
    const averageRamGiB = totalRamSum / items.length

    // Convert GiB to MiB (Megabytes) and round to the nearest whole number
    const averageRamMiB = averageRamGiB * 1024
    const averageTotalMemoryMbRounded = Math.round(averageRamMiB)

    // --- 2. Get Historical Load Metrics ---
    const getLoadAt = (minutesAgo: number) => {
        const targetIndex = items.length - 1 - minutesAgo
        if (targetIndex < 0) return null // Not enough data

        const record = items[targetIndex]
        const loadArray = record?.stats?.la
        
        // Return the 1-minute load from that time period
        return (loadArray && loadArray.length > 0) ? loadArray[0] : null
    }

    const load = {
        "1m": getLoadAt(0), // Most recent
        "10min": getLoadAt(10),
        "20min": getLoadAt(20),
        "120min": getLoadAt(120), // 2 hours
        "480min": getLoadAt(480), // 8 hours
    }

    return {
        load: load,
        average_total_memory_mb_rounded: averageTotalMemoryMbRounded,
    }
}

export async function getBeszelMetrics({
    url,
    pb_email,
    pb_password,
    allowInsecureCerts = false,
}: {
    url: string
    pb_email: string
    pb_password: string
    allowInsecureCerts?: boolean
}) {
    const { token } = await createToken({ url, pb_email, pb_password, allowInsecureCerts })

    const systems = await fetchSystems(url, token, allowInsecureCerts)

    const normalized: Record<string, any> = {}

    for (const sys of systems) {
        if (!sys.id) continue

        const normalizedSystem = normalizeSystemRecord(sys)

        const historicalStats = await fetchSystemStatsForSystem(sys.id, {
            url,
            token,
            allowInsecureCerts,
        })

        if (historicalStats.average_total_memory_mb_rounded !== null) {
            normalizedSystem.details.memory_total_mb = historicalStats.average_total_memory_mb_rounded
        }

        normalized[sys.name || sys.host || "main"] = normalizedSystem
    }

    return { systems: normalized }
}