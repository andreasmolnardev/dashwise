import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";

export async function getSearchItems(userId: string) {
  const pb = await getSuperuserPB();
  const searchItemRecord = await pb
    .collection("userSearchItems")
    .getFirstListItem(`associatedUserId="${userId}"`);

  return searchItemRecord.searchItems;
}
