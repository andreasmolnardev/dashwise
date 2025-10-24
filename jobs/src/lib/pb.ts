import PocketBase from 'pocketbase';
import { config } from '../config/env';

const pb = new PocketBase(config.PB_URL);


export async function getSuperuserPB() {
    const pb = new PocketBase(config.PB_URL);
    await pb.collection('_superusers').authWithPassword(config.PB_ADMIN_EMAIL, config.PB_ADMIN_PASSWORD);
    return pb;
}


export default pb;
