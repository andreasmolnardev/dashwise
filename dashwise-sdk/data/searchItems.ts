import { getSuperuserPB } from "@/lib/pb";

export async function getSearchItems(userId: string) {
  const pb = await getSuperuserPB();
  const searchItemRecord = await pb
    .collection("userSearchItems")
    .getFirstListItem(`associatedUserId="${userId}"`);

  return searchItemRecord.searchItems;
}
