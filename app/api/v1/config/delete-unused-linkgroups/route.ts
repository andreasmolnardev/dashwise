import { getServerPB } from "@/lib/pb";
import { NextResponse } from "next/server";

/**
 * Types for config shape
 */
interface Link {
  icon?: string;
  linkGroup: string;
  name: string;
  url: string;
  [key: string]: any; // allow extra props if present
}

interface UserConfig {
  linkGroups?: string[];
  links?: Link[];
  [key: string]: any;
}

/**
 * POST /api/v1/config/delete-unused-linkgroups
 * Cleans up:
 *  - removes linkGroups that have no links referencing them
 *  - removes links that reference missing groups
 */
export async function POST(request: Request) {
  try {
    // --- auth (same pattern you use elsewhere) ---
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.split(" ")[1];
    const pb = getServerPB();
    pb.authStore.save(token, null);

    const authModel = await pb.collection("users").authRefresh();
    if (!authModel) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // --- fetch user config record ---
    const record: any = await pb
      .collection("userConfig")
      .getFirstListItem(`associatedUserId="${authModel.record.id}"`);

    // cast to typed config
    const config = (record.config ?? {}) as UserConfig;

    // ensure arrays exist and have correct types
    config.linkGroups = Array.isArray(config.linkGroups) ? (config.linkGroups as string[]) : [];
    config.links = Array.isArray(config.links) ? (config.links as Link[]) : [];

    const originalLinkGroups: string[] = [...config.linkGroups];
    const originalLinks: Link[] = [...(config.links as Link[])];

    // --- compute groups that are actually referenced by links ---
    const usedGroups = new Set<string>(
      (config.links as Link[])
        .map((L: Link) => (typeof L.linkGroup === "string" ? L.linkGroup.trim() : String(L.linkGroup)))
        .filter(Boolean)
    );

    // keep only groups referenced by at least one link (trimmed)
    const prunedLinkGroups = (config.linkGroups as string[])
      .map((g: string) => (typeof g === "string" ? g.trim() : String(g)))
      .filter((g: string) => usedGroups.has(g));

    // dedupe while preserving first-occurrence order
    const uniquePrunedLinkGroups: string[] = Array.from(new Set(prunedLinkGroups));

    // keep only links whose linkGroup exists in the pruned groups list
    const prunedLinks: Link[] = (config.links as Link[]).filter((L: Link) =>
      uniquePrunedLinkGroups.includes(typeof L.linkGroup === "string" ? L.linkGroup.trim() : String(L.linkGroup))
    );

    // --- compute removed items for reporting ---
    const removedLinkGroups = originalLinkGroups.filter(
      (g) => !uniquePrunedLinkGroups.includes(typeof g === "string" ? g.trim() : String(g))
    );

    // annotate 'pl' as Link to avoid implicit any
    const removedLinks = originalLinks.filter((l: Link) =>
      !prunedLinks.some((pl: Link) =>
        pl.url === l.url &&
        pl.name === l.name &&
        (pl.linkGroup === l.linkGroup || String(pl.linkGroup).trim() === String(l.linkGroup).trim())
      )
    );

    // --- persist cleaned config back to PocketBase ---
    config.linkGroups = uniquePrunedLinkGroups;
    config.links = prunedLinks;

    await pb.collection("userConfig").update(record.id, { config });

    // --- return small report so caller can verify changes ---
    return NextResponse.json(
      {
        success: true,
        removedLinkGroups,
        removedLinks,
        updatedCounts: {
          linkGroups: config.linkGroups.length,
          links: config.links.length,
        },
        // include a tiny config summary so client can re-sync if needed
        config: {
          linkGroups: config.linkGroups,
          links: config.links.length,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error cleaning config:", err);
    return NextResponse.json({ error: "Failed to clean config" }, { status: 500 });
  }
}
