import path from 'path';
import { promises as fs } from 'fs';
import { ClientResponseError } from 'pocketbase';

// cache default config in memory to avoid repeated FS reads
let _cachedDefaultConfig: any = null;

async function loadDefaultConfig() {
  if (_cachedDefaultConfig) return _cachedDefaultConfig;
  const configPath = path.join(process.cwd(), 'public', 'default-config.json');
  const configFile = await fs.readFile(configPath, 'utf-8');
  _cachedDefaultConfig = JSON.parse(configFile);
  return _cachedDefaultConfig;
}

/**
 * Ensure a userConfig exists for `userId`. Returns the userConfig record.
 * - If one exists, returns it.
 * - If none exists, checks that the user exists in 'users' collection. If yes, creates userConfig from default-config.json.
 * - Throws if the user does not exist or other fatal errors happen.
 */
export async function ensureUserConfig(pb: any, userId: string) {
  // 1) try to get existing config
  try {
    const rec = await pb.collection('userConfig').getFirstListItem(
      `associatedUserId="${userId}"`
    );
    return rec;
  } catch (err: any) {
    // if not found, create; otherwise rethrow
    if (err instanceof ClientResponseError && err.status === 404) {
      // continue to creation path
    } else {
      throw err;
    }
  }

  // 2) verify the user exists in 'users' collection
  try {
    // use getOne to check existence (throws 404 if not found)
    await pb.collection('users').getOne(userId);
  } catch (err: any) {
    if (err instanceof ClientResponseError && err.status === 404) {
      const e = new Error('Associated user not found');
      // attach status for nicer handling upstream
      // @ts-ignore
      e.status = 403;
      throw e;
    }
    throw err;
  }

  // 3) load default config and create userConfig
  const defaultConfig = await loadDefaultConfig();

  const createPayload = {
    associatedUserId: userId,
    config: defaultConfig,
  };

  const created = await pb.collection('userConfig').create(createPayload);
  return created;
}
