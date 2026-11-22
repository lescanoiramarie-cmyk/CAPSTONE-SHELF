import { createClient } from "@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const EXISTING_SUPERADMIN_ID =
  "919c949a-ee98-4137-8a98-072ec8aa5fb1";

const headers = {
  // Staff operations require a verified Super Admin session with AAL2 MFA.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(
  status: number,
  body: Record<string, unknown>
) {
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

// Keep database internals out of client responses while returning actionable
// guidance for common CRUD failures.
function sanitizeDbError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("duplicate key") || normalized.includes("already exists")) {
    return "A staff account with this email already exists.";
  }
  if (normalized.includes("schema cache") || (normalized.includes("column") && normalized.includes("does not exist"))) {
    return "The staff database is not up to date. Apply the latest database migrations, then try again.";
  }
  if (normalized.includes("constraint") || normalized.includes("foreign key")) {
    return "This staff change conflicts with related records. Review the branch and related records, then try again.";
  }
  return "The staff profile could not be saved. Refresh the staff list and try again.";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (request.method !== "POST") {
    return respond(405, {
      error: "Method not allowed.",
    });
  }

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond(500, {
      error:
        "Staff provisioning is not configured on the server.",
    });
  }

  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch {
    return respond(400, {
      error: "Invalid JSON request body.",
    });
  }

  const authorization =
    request.headers.get("Authorization");

  if (!authorization) {
    return respond(401, {
      error:
        "Sign in with an authorized super-admin account.",
    });
  }

  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return respond(401, {
      error: "Sign in with an authorized super-admin account.",
    });
  }

  const userClient = createClient(
    supabaseUrl,
    anonKey,
    {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  const { data: authData, error: authError } =
    await userClient.auth.getUser(accessToken);

  if (
    authError ||
    !authData.user ||
    authData.user.app_metadata?.role !== "superadmin"
  ) {
    return respond(403, {
      error:
        "Only an authenticated super-admin can manage staff accounts.",
    });
  }

  // Require AAL2 (MFA verified) for all administrative staff operations.
  // This Edge Function creates a stateless Auth client, so it has no local
  // session for getAuthenticatorAssuranceLevel() to inspect. Pass the caller's
  // JWT explicitly so Supabase reads its aal claim and verified factors.
  const { data: assurance, error: assuranceError } =
    await userClient.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);

  if (assuranceError || assurance?.currentLevel !== "aal2") {
    return respond(403, {
      error:
        "AAL2 authentication (MFA) is required for staff management operations.",
    });
  }

  // Confirm the caller's current database role and active state before using the
  // service-role client, which bypasses RLS for staff management operations.
  const { data: callerProfile, error: callerProfileError } = await userClient
    .from("staff_profiles")
    .select("role, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (
    callerProfileError ||
    !callerProfile ||
    callerProfile.role !== "superadmin" ||
    callerProfile.is_active !== true ||
    callerProfile.role !== authData.user.app_metadata?.role
  ) {
    return respond(403, {
      error: "Only an active super-admin can manage staff accounts.",
    });
  }

  const admin = createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  try {
    /*
     * CREATE SUB-ADMIN
     */
    if (body.operation === "create") {
      const email = String(body.email || "")
        .trim()
        .toLowerCase();

      const fullName = String(
        body.fullName || ""
      ).trim();

      const password = String(
        body.password || ""
      );

      const libraryId = String(
        body.libraryId || ""
      );

      if (
        !email ||
        !fullName ||
        password.length < 10 ||
        !libraryId
      ) {
        return respond(400, {
          error:
            "Name, email, a 10-character password, and branch are required.",
        });
      }

      const { data: library, error: libraryError } =
        await admin
          .from("libraries")
          .select("id")
          .eq("id", libraryId)
          .maybeSingle();

      if (libraryError || !library) {
        return respond(400, {
          error: "Select a valid library branch.",
        });
      }

      const {
        data: created,
        error: createError,
      } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,

        app_metadata: {
          role: "subadmin",
          library_id: libraryId,
          is_active: true,
        },

        user_metadata: {
          full_name: fullName,
        },
      });

      if (createError || !created.user) {
        return respond(400, {
          error:
            createError?.message ||
            "Unable to create staff account.",
        });
      }

      const { error: profileError } =
        await admin
          .from("staff_profiles")
          .insert({
            id: created.user.id,
            email,
            full_name: fullName,
            role: "subadmin",
            library_id: libraryId,
          });

      if (profileError) {
        await admin.auth.admin.deleteUser(
          created.user.id
        );

        return respond(400, {
          error: sanitizeDbError(profileError.message),
        });
      }

      return respond(200, {
        id: created.user.id,
        email,
        role: "subadmin",
        libraryId,
      });
    }


    /*
     * UPDATE SUB-ADMIN
     */
    if (body.operation === "update") {
      const userId = String(body.userId || "").trim();
      const fullName = String(body.fullName || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const libraryId = String(body.libraryId || "").trim();
      const password = String(body.password || "");

      if (!userId || !fullName || !email || !libraryId) {
        return respond(400, {
          error: "Staff ID, name, email, and assigned library are required.",
        });
      }

      if (password && password.length < 10) {
        return respond(400, {
          error: "Password must contain at least 10 characters.",
        });
      }

      if (userId === authData.user.id || userId === EXISTING_SUPERADMIN_ID) {
        return respond(403, {
          error: "Super Admin accounts cannot be modified through this endpoint.",
        });
      }

      const { data: profile, error: profileError } = await admin
        .from("staff_profiles")
        .select("id, email, full_name, role, library_id, is_active")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) {
        return respond(400, {
          error: sanitizeDbError(profileError.message),
        });
      }

      if (profile?.role === "superadmin") {
        return respond(403, {
          error: "Super Admin accounts cannot be modified through this endpoint.",
        });
      }

      if (!profile || profile.role !== "subadmin") {
        return respond(404, {
          error: "Sub-admin account not found.",
        });
      }

      const { data: library, error: libraryError } = await admin
        .from("libraries")
        .select("id")
        .eq("id", libraryId)
        .maybeSingle();

      if (libraryError || !library) {
        return respond(400, {
          error: "Select a valid library branch.",
        });
      }

      const { data: authUser, error: authUserError } =
        await admin.auth.admin.getUserById(userId);

      if (authUserError || !authUser?.user) {
        return respond(404, {
          error: "Sub-admin Auth account not found.",
        });
      }

      const { error: updateError } = await admin
        .from("staff_profiles")
        .update({
          full_name: fullName,
          email,
          library_id: libraryId,
        })
        .eq("id", userId);

      if (updateError) {
        return respond(400, {
          error: sanitizeDbError(updateError.message),
        });
      }

      const { error: authUpdateError } =
        await admin.auth.admin.updateUserById(userId, {
          email,
          email_confirm: true,
          ...(password ? { password } : {}),
          app_metadata: {
            ...(authUser.user.app_metadata || {}),
            role: "subadmin",
            library_id: libraryId,
            is_active: profile.is_active,
          },
          user_metadata: {
            ...(authUser.user.user_metadata || {}),
            full_name: fullName,
          },
        });

      if (authUpdateError) {
        // Restore the database profile if updating Auth fails. The staff
        // profile trigger also restores the corresponding role claims.
        const { error: rollbackError } = await admin
          .from("staff_profiles")
          .update({
            full_name: profile.full_name,
            email: authUser.user.email || profile.email,
            library_id: profile.library_id,
          })
          .eq("id", userId);
        return respond(400, {
          error: rollbackError
            ? "The account update failed and could not be rolled back. Ask an administrator to review this account."
            : authUpdateError.message,
        });
      }

      return respond(200, {
        success: true,
        id: userId,
        message: "Sub-admin account updated successfully.",
      });
    }


    /*
     * DELETE SUB-ADMIN
     */
    if (body.operation === "delete") {
      const userId = String(body.userId || "").trim();

      if (!userId) {
        return respond(400, {
          error: "A staff account ID is required.",
        });
      }

      if (userId === authData.user.id || userId === EXISTING_SUPERADMIN_ID) {
        return respond(403, {
          error: "Super Admin accounts cannot be modified through this endpoint.",
        });
      }

      const { data: profile, error: profileError } = await admin
        .from("staff_profiles")
        .select("id, role")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) {
        return respond(400, {
          error: sanitizeDbError(profileError.message),
        });
      }

      if (profile?.role === "superadmin") {
        return respond(403, {
          error: "Super Admin accounts cannot be deleted through this endpoint.",
        });
      }

      if (!profile || profile.role !== "subadmin") {
        return respond(404, {
          error: "Sub-admin account not found.",
        });
      }

      const { error: deleteAuthError } =
        await admin.auth.admin.deleteUser(userId);

      if (deleteAuthError) {
        return respond(400, {
          error: deleteAuthError.message,
        });
      }

      return respond(200, {
        success: true,
        id: userId,
        message: "Sub-admin account deleted successfully.",
      });
    }

    /*
     * ENABLE / DISABLE SUB-ADMIN
     */
    if (body.operation === "set-active") {
      const userId = String(
        body.userId || ""
      );

      const isActive =
        body.isActive === true;

      if (!userId) {
        return respond(400, {
          error:
            "A staff account ID is required.",
        });
      }

      if (userId === authData.user.id || userId === EXISTING_SUPERADMIN_ID) {
        return respond(403, {
          error: "Super Admin accounts cannot be deactivated through this endpoint.",
        });
      }

      const {
        data: profile,
        error: profileError,
      } = await admin
        .from("staff_profiles")
        .select("id, role, library_id, is_active")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) {
        return respond(400, {
          error: sanitizeDbError(profileError.message),
        });
      }

      if (profile?.role === "superadmin") {
        return respond(403, {
          error: "Super Admin accounts cannot be deactivated through this endpoint.",
        });
      }

      if (
        !profile ||
        profile.role !== "subadmin"
      ) {
        return respond(404, {
          error:
            "Sub-admin account not found.",
        });
      }


      const {
        data: authUser,
        error: authUserError,
      } = await admin.auth.admin.getUserById(userId);

      if (authUserError || !authUser?.user) {
        return respond(404, {
          error: "Sub-admin Auth account not found.",
        });
      }

      const {
        error: authUpdateError,
      } = await admin.auth.admin.updateUserById(
        userId,
        {
          ban_duration: isActive
            ? "none"
            : "876000h",

          app_metadata: {
            ...(authUser.user.app_metadata || {}),
            role: "subadmin",
            library_id: profile.library_id,
            is_active: isActive,
          },
        }
      );

      if (authUpdateError) {
        return respond(400, {
          error: authUpdateError.message,
        });
      }

      const { error: updateError } =
        await admin
          .from("staff_profiles")
          .update({
            is_active: isActive,
          })
          .eq("id", userId);

      if (updateError) {
        const { error: rollbackError } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: profile.is_active ? "none" : "876000h",
          app_metadata: authUser.user.app_metadata || {},
        });
        return respond(400, {
          error: rollbackError
            ? "The account status update failed and could not be rolled back. Ask an administrator to review this account."
            : sanitizeDbError(updateError.message),
        });
      }

      return respond(200, {
        id: userId,
        isActive,
      });
    }

    return respond(400, {
      error:
        "Unsupported staff management operation.",
    });
  } catch (error) {
    return respond(500, {
      error:
        error instanceof Error
          ? error.message
          : "Unexpected staff management error.",
    });
  }
});
