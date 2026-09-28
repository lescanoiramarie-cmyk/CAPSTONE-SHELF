import { createClient } from "@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const resetSecret = Deno.env.get("STAFF_PASSWORD_RESET_SECRET") || "";
const allowedOrigin =
  Deno.env.get("APP_ORIGIN") || "http://localhost:5173";

const EXISTING_SUPERADMIN_ID =
  "919c949a-ee98-4137-8a98-072ec8aa5fb1";

const headers = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-staff-reset-secret",
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

  /*
   * TEMPORARY SUPER ADMIN PASSWORD RESET
   *
   * This branch MUST execute before the normal
   * authenticated-super-admin check.
   *
   * It is protected by:
   * 1. STAFF_PASSWORD_RESET_SECRET
   * 2. Exact existing Super Admin UUID
   *
   * The service-role key remains server-side.
   */
  if (body.operation === "set-password") {
    if (!resetSecret) {
      return respond(500, {
        error:
          "Staff password reset is not configured on the server.",
      });
    }

    const providedSecret =
      request.headers.get("x-staff-reset-secret") || "";

    if (
      !providedSecret ||
      providedSecret !== resetSecret
    ) {
      return respond(401, {
        error: "Invalid staff password reset authorization.",
      });
    }

    const userId = String(body.userId || "").trim();
    const newPassword = String(body.password || "");

    if (userId !== EXISTING_SUPERADMIN_ID) {
      return respond(403, {
        error:
          "This temporary reset endpoint is restricted to the existing Super Admin account.",
      });
    }

    if (newPassword.length < 10) {
      return respond(400, {
        error:
          "Password must contain at least 10 characters.",
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
      const { data: profile, error: profileError } =
        await admin
          .from("staff_profiles")
          .select(
            "id, email, full_name, role, library_id, is_active"
          )
          .eq("id", userId)
          .maybeSingle();

      if (profileError) {
        return respond(400, {
          error: profileError.message,
        });
      }

      if (!profile) {
        return respond(404, {
          error: "Super Admin staff profile not found.",
        });
      }

      if (profile.role !== "superadmin") {
        return respond(403, {
          error:
            "The specified account is not the SHELF Super Admin.",
        });
      }

      const { data: authUser, error: authUserError } =
        await admin.auth.admin.getUserById(userId);

      if (authUserError || !authUser?.user) {
        return respond(404, {
          error:
            authUserError?.message ||
            "Super Admin Auth user not found.",
        });
      }

      const existingAppMetadata =
        authUser.user.app_metadata || {};

      const existingUserMetadata =
        authUser.user.user_metadata || {};

      const { data: updatedUser, error: passwordError } =
        await admin.auth.admin.updateUserById(
          userId,
          {
            password: newPassword,

            app_metadata: {
              ...existingAppMetadata,
              role: "superadmin",
              is_active: true,
            },

            user_metadata: {
              ...existingUserMetadata,
              full_name: profile.full_name,
            },
          }
        );

      if (passwordError || !updatedUser?.user) {
        return respond(400, {
          error:
            passwordError?.message ||
            "Unable to update the Super Admin password.",
        });
      }

      const { error: profileUpdateError } =
        await admin
          .from("staff_profiles")
          .update({
            is_active: true,
          })
          .eq("id", userId);

      if (profileUpdateError) {
        return respond(400, {
          error: profileUpdateError.message,
        });
      }

      return respond(200, {
        success: true,
        id: profile.id,
        email: profile.email,
        role: profile.role,
        message:
          "Super Admin password updated successfully.",
      });
    } catch (error) {
      return respond(500, {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected password reset error.",
      });
    }
  }

  /*
   * NORMAL STAFF MANAGEMENT
   *
   * CREATE and SET-ACTIVE require an authenticated
   * Super Admin account.
   */

  const authorization =
    request.headers.get("Authorization");

  if (!authorization) {
    return respond(401, {
      error:
        "Sign in with an authorized super-admin account.",
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
    await userClient.auth.getUser();

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
          error: profileError.message,
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

      const {
        data: profile,
        error: profileError,
      } = await admin
        .from("staff_profiles")
        .select("id, role, library_id")
        .eq("id", userId)
        .maybeSingle();

      if (
        profileError ||
        !profile ||
        profile.role !== "subadmin"
      ) {
        return respond(404, {
          error:
            "Sub-admin account not found.",
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
        return respond(400, {
          error: updateError.message,
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
