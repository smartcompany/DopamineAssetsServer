import { getSupabaseAdmin } from "./supabase-admin";

export type UserSuspensionState = {
  suspended: boolean;
  suspendedUntil: string | null;
};

export async function getUserSuspensionState(
  uid: string,
): Promise<UserSuspensionState> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("dopamine_user_profiles")
    .select("suspended_until")
    .eq("uid", uid)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const suspendedUntilRaw =
    (data?.suspended_until as string | null | undefined) ?? null;
  if (!suspendedUntilRaw) {
    return { suspended: false, suspendedUntil: null };
  }
  const t = new Date(suspendedUntilRaw).getTime();
  if (!Number.isFinite(t)) {
    return { suspended: false, suspendedUntil: null };
  }
  return {
    suspended: t > Date.now(),
    suspendedUntil: suspendedUntilRaw,
  };
}

