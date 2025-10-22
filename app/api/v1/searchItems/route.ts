import { getServerPB } from '@/lib/pb';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
   try {
      const authHeader = request.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) {
         return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const token = authHeader.split(' ')[1];
      const pb = getServerPB();
      pb.authStore.save(token, null);

      const authModel = await pb.collection('users').authRefresh();
      if (!authModel) {
         return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      
      const searchItemRecord = await pb.collection('userSearchItems').getFirstListItem(
         `associatedUserId="${authModel.record.id}"`
      );

      return NextResponse.json(searchItemRecord.searchItems);
   } catch (error) {
      console.error('Error fetching config:', error);
      return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
   }
}
