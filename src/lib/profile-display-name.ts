import type { SupabaseClient } from "@supabase/supabase-js";

/** 대소문자·앞뒤 공백 무시. 다른 uid 가 동일 표시 닉네임을 쓰는지. */
export async function isDisplayNameTakenByOther(
  supabase: SupabaseClient,
  uid: string,
  displayName: string,
): Promise<boolean> {
  const want = displayName.trim().toLowerCase();
  if (want.length === 0) return false;

  const { data, error } = await supabase
    .from("dopamine_user_profiles")
    .select("uid, display_name")
    .neq("uid", uid);

  if (error) {
    throw error;
  }
  for (const row of data ?? []) {
    const dn = row.display_name;
    if (typeof dn !== "string") continue;
    if (dn.trim().toLowerCase() === want) return true;
  }
  return false;
}
