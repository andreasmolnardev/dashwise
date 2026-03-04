import { ClientResponseError } from "pocketbase";
import { getServerPB } from "@/lib/pb";

export class ApiActionError extends Error {
  status: number;
  body?: any;

  constructor(message: string, status = 500, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export type ActionAuth = {
  token?: string | null;
};

export async function requireUserAuth(auth?: ActionAuth) {
  if (!auth?.token) {
    throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
  }

  const pb = getServerPB();
  pb.authStore.save(auth.token, null);

  try {
    const authModel = await pb.collection("users").authRefresh();
    const userId = authModel?.record?.id;

    if (!userId) {
      throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
    }

    return { pb, userId, authModel };
  } catch (error) {
    if (error instanceof ApiActionError) {
      throw error;
    }

    if (error instanceof ClientResponseError && error.status === 401) {
      throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
    }

    throw error;
  }
}
