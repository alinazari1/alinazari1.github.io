import {
  createClient
} from "https://esm.sh/@supabase/supabase-js@2";

import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
} from "./Signin/account-config.js";

const signInLink = document.getElementById("homepage-signin");
const userArea = document.getElementById("homepage-user");
const nameElement = document.getElementById("homepage-name");
const signOutButton = document.getElementById("homepage-signout");
const statusElement = document.getElementById(
  "homepage-account-status"
);

async function initializeHomepageAccount() {
  if (
    !signInLink ||
    !userArea ||
    !nameElement ||
    !signOutButton ||
    !statusElement
  ) {
    return;
  }

  if (
    SUPABASE_URL.includes("YOUR_PROJECT_REF") ||
    SUPABASE_PUBLISHABLE_KEY ===
      "YOUR_SUPABASE_PUBLISHABLE_KEY"
  ) {
    statusElement.textContent = "Account service is not configured.";
    return;
  }

  const client = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

  function renderUser(user) {
    signInLink.hidden = Boolean(user);
    userArea.hidden = !user;

    if (!user) {
      nameElement.textContent = "";
      return;
    }

    const metadata = user.user_metadata || {};

    const fullName =
      typeof metadata.full_name === "string"
        ? metadata.full_name.trim()
        : "";

    const otherName =
      typeof metadata.name === "string"
        ? metadata.name.trim()
        : "";

    const emailName = user.email
      ? user.email.split("@")[0]
      : "";

    // Use textContent, not innerHTML, for user-provided names.
    nameElement.textContent =
      fullName || otherName || emailName || "there";
  }

  let authVersion = 0;

  // Keep the UI synchronized with sign-in/out and profile changes.
  // Do not await other Supabase methods inside this callback.
  client.auth.onAuthStateChange((event, session) => {
    authVersion += 1;
    renderUser(session?.user || null);
    statusElement.textContent = "";
  });

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    statusElement.textContent = "Signing out…";

    try {
      const { error } = await client.auth.signOut({
        scope: "local"
      });

      if (error) throw error;

      renderUser(null);
      statusElement.textContent = "You are signed out.";
    } catch (error) {
      console.error("Sign-out failed:", error);

      statusElement.textContent =
        "Could not sign out. Please try again.";
    } finally {
      signOutButton.disabled = false;
    }
  });

  // Restore the account display after opening or refreshing Home.
  try {
    await client.auth.getSession();

    const versionBeforeLookup = authVersion;

    const {
      data: { user },
      error
    } = await client.auth.getUser();

    // Ignore an outdated lookup if auth changed while it ran.
    if (versionBeforeLookup !== authVersion) return;

    if (error && error.name !== "AuthSessionMissingError") {
      throw error;
    }

    renderUser(user);
    statusElement.textContent = "";
  } catch (error) {
    console.error("Account lookup failed:", error);

    statusElement.textContent =
      "Could not verify your account. Please refresh.";
  }
}

initializeHomepageAccount().catch((error) => {
  console.error("Homepage account initialization failed:", error);

  if (statusElement) {
    statusElement.textContent =
      "Account service could not be loaded.";
  }
});
