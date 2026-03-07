import config from "@/lib/config";
import getDashdotMetrics from "@/lib/clients/dashdot/client";
import { getBookmarks } from "@/lib/clients/karakeep/client";
import { getBeszelSystemHealth } from "@/lib/clients/beszel/client";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";

async function getUserConfigRecord(userId: string) {
  const pb = await getSuperuserPB();
  const configRecord = await pb
    .collection("userConfig")
    .getFirstListItem(`associatedUserId="${userId}"`);
  return configRecord;
}

export async function getKarakeepData(userId: string, latestOnly = false) {
  const configRecord = await getUserConfigRecord(userId);

  const apiToken = Buffer.from(
    configRecord.config.integrations.Karakeep.api_token,
    "base64"
  ).toString("utf8");
  const serverLocation = Buffer.from(
    configRecord.config.integrations.Karakeep.server_location,
    "base64"
  ).toString("utf8");

  const bookmarks = await getBookmarks({
    serverUrl: serverLocation,
    token: apiToken,
    allowInsecureCerts: !!config.allowInsecureCertsForIntegrationUrls,
  });

  if (latestOnly) {
    const latest = [...(bookmarks ?? [])]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);

    return { latest, serverDetails: { url: serverLocation } };
  }

  return { bookmarks, serverDetails: { url: serverLocation } };
}

export async function getDashdotData(userId: string, body: any) {
  const configRecord = await getUserConfigRecord(userId);

  const serverUrl =
    body?.serverUrl ??
    Buffer.from(configRecord.config.integrations.Dashdot.server_location, "base64").toString(
      "utf8"
    );

  const displayName =
    body?.displayName ??
    Buffer.from(
      configRecord.config.integrations.Dashdot.server_displayname,
      "base64"
    ).toString("utf8");

  const metrics = await getDashdotMetrics({
    serverUrl,
    allowInsecureCerts: !!config.allowInsecureCertsForIntegrationUrls,
  });

  return { metrics, serverDetails: { url: serverUrl, displayName } };
}

export async function getBeszelSystemHealthstats(userId: string) {
  const configRecord = await getUserConfigRecord(userId);

  const serverLocation = Buffer.from(
    configRecord.config.integrations.Beszel.server_location,
    "base64"
  ).toString("utf8");
  const pbAdminEmail = Buffer.from(
    configRecord.config.integrations.Beszel.pb_email,
    "base64"
  ).toString("utf8");
  const pbAdminPassword = Buffer.from(
    configRecord.config.integrations.Beszel.pb_password,
    "base64"
  ).toString("utf8");

  return getBeszelSystemHealth({
    url: serverLocation,
    pb_email: pbAdminEmail,
    pb_password: pbAdminPassword,
    allowInsecureCerts: !!config.allowInsecureCertsForIntegrationUrls,
  });
}
