import PocketBase from 'pocketbase';
import { config } from '../config/env';

const pb = new PocketBase(config.PB_URL);


export async function getSuperuserPB() {
    const pb = new PocketBase(config.PB_URL);
    try {
        await pb.collection('_superusers').authWithPassword(
            config.PB_ADMIN_EMAIL,
            config.PB_ADMIN_PASSWORD
        );

        return pb;
    } catch (err) {
        throw new Error('Authenticating to pocketbase failed: ' + (err instanceof Error ? err.message : err));
    }
}



export default pb;
