import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./account-config.js";

const $ = (id) => document.getElementById(id);
let client;
let session = null;
let view = "login";
let busy = false;
let recovery = new URLSearchParams(location.search).get("mode") === "recovery";
const callbackURL = new URL(location.pathname, location.origin).href;

function notice(text = "", tone = "info") {
  $("status").textContent = text;
  $("status").dataset.tone = tone;
}
function render() {
  const signedIn = Boolean(session);
  $("auth-panel").hidden = signedIn;
  $("account-panel").hidden = !signedIn || recovery;
  $("password-form").hidden = !signedIn || !recovery;
  for (const name of ["login", "register", "forgot"]) {
    $(`${name}-form`).hidden = name !== view;
  }
  $("login-tab").setAttribute("aria-pressed", String(view === "login"));
  $("register-tab").setAttribute("aria-pressed", String(view === "register"));
  $("account-email").textContent = session?.user?.email || "";
}
function changeView(next) {
  view = next;
  notice();
  render();
}
async function perform(task) {
  if (busy || !client) return;
  busy = true;
  const controls = [...document.querySelectorAll("button, input")].filter(el => !el.disabled);
  controls.forEach(el => { el.disabled = true; });
  document.querySelector(".card").setAttribute("aria-busy", "true");
  try { await task(); }
  catch (error) {
    console.error("Account action failed:", error);
    notice("The request could not be completed. Check your connection and try again.", "error");
  }
  finally {
    controls.forEach(el => { el.disabled = false; });
    document.querySelector(".card").removeAttribute("aria-busy");
    busy = false;
  }
}
function checkedForm(id, handler) {
  $(id).addEventListener("submit", event => {
    event.preventDefault();
    if (!$(id).reportValidity()) return;
    // Read values before perform disables inputs.
    handler();
  });
}
$("login-tab").addEventListener("click", () => changeView("login"));
$("register-tab").addEventListener("click", () => changeView("register"));
$("back-button").addEventListener("click", () => changeView("login"));
$("forgot-button").addEventListener("click", () => {
  $("forgot-email").value = $("login-email").value;
  changeView("forgot");
});
$("cancel-recovery").addEventListener("click", () => {
  recovery = false;
  history.replaceState({}, "", location.pathname);
  $("password-form").reset();
  notice(); render();
});

checkedForm("login-form", () => {
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  perform(async () => {
    notice("Signing in…");
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      notice("Unable to sign in. Check your email and password, confirm your email if required, or request a password reset.", "error");
      return;
    }
    session = data.session;
    recovery = false;
    $("login-form").reset();
    history.replaceState({}, "", location.pathname);
    render(); notice("You are signed in.", "success");
  });
});

checkedForm("register-form", () => {
  const fullName = $("register-name").value.trim();
  const organization = $("register-organization").value.trim();
  const email = $("register-email").value.trim();
  const password = $("register-password").value;
  if (!fullName) { notice("Please enter your full name.", "error"); return; }
  if (password !== $("register-confirm").value) {
    notice("The passwords do not match.", "error"); return;
  }
  perform(async () => {
    notice("Creating your account…");
    const { data, error } = await client.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: callbackURL,
        data: { full_name: fullName, organization }
      }
    });
    if (error) {
      notice("Registration could not be completed. Check the site's password requirements, try again later, or sign in if you already have an account.", "error");
      console.error("Registration error:", error);
      return;
    }
    $("register-form").reset();
    session = data.session;
    view = "login";
    render();
    notice(session
      ? "Account created. You are signed in."
      : "If registration is available for this address, check your email for a confirmation link. If you already have an account, sign in or reset your password.", "success");
  });
});

checkedForm("forgot-form", () => {
  const email = $("forgot-email").value.trim();
  perform(async () => {
    notice("Requesting a reset link…");
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${callbackURL}?mode=recovery`
    });
    if (error) {
      console.error("Password reset request error:", error);
      notice("A reset link could not be requested now. Please try again later.", "error");
      return;
    }
    notice("If an eligible account exists, a reset link will be sent. Check your inbox and spam folder.", "success");
  });
});

checkedForm("password-form", () => {
  const password = $("new-password").value;
  if (password !== $("new-confirm").value) {
    notice("The passwords do not match.", "error"); return;
  }
  perform(async () => {
    notice("Updating your password…");
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      console.error("Password update error:", error);
      notice("The password could not be updated. Check the password requirements or request a fresh reset link.", "error");
      return;
    }
    recovery = false;
    $("password-form").reset();
    history.replaceState({}, "", location.pathname);
    render(); notice("Your password has been updated.", "success");
  });
});

$("signout-button").addEventListener("click", () => perform(async () => {
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw error;
  session = null;
  recovery = false;
  view = "login";
  render(); notice("You are signed out on this browser.", "success");
}));

async function initialize() {
  if (location.protocol === "file:") {
    notice("Open this page through an HTTP development server or your HTTPS website, not directly as a file.", "error");
    return;
  }
  if (SUPABASE_URL.includes("YOUR_PROJECT_REF") || SUPABASE_PUBLISHABLE_KEY === "YOUR_SUPABASE_PUBLISHABLE_KEY") {
    notice("Set the project URL and publishable key in account-config.js first.", "error");
    return;
  }
  client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  client.auth.onAuthStateChange((event, nextSession) => {
    session = nextSession;
    if (event === "PASSWORD_RECOVERY") recovery = true;
    if (event === "SIGNED_OUT") recovery = false;
    render();
  });
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  session = data.session;
  render();
  if (recovery && !session) {
    view = "forgot";
    render();
    notice("No recovery session is available. Request a fresh password reset link.", "error");
  } else {
    notice(session ? "You are signed in." : "", session ? "success" : "info");
  }
}
initialize().catch(error => {
  console.error("Account initialization failed:", error);
  notice("Account services could not be loaded. Check configuration and reload the page.", "error");
});
