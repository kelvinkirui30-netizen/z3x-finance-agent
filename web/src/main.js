import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, reload } from "firebase/auth";
import { getFirestore, collection, getDocs, query, orderBy, limit, where } from "firebase/firestore";
import "./styles.css";

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
const $ = (selector) => document.querySelector(selector);
const authScreen = $("#auth-screen");
const portal = $("#portal");
const authMessage = $("#auth-message");
let signedInUser = null;
let currentRole = "user";
let authMode = "signin";

if (missing.length) {
  authMessage.textContent = "Website configuration is incomplete. Add the VITE_FIREBASE_* environment variables in Vercel.";
  $("#google-signin").disabled = true;
} else {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  $("#activate-super-admin").addEventListener("click", async () => {
    const secret = $("#bootstrap-secret").value;
    const button = $("#activate-super-admin");
    const message = $("#bootstrap-message");
    if (!signedInUser || signedInUser.email !== "shadowvybez001@gmail.com") {
      message.textContent = "Sign in with the approved, verified owner email account first.";
      return;
    }
    if (!secret) {
      message.textContent = "Enter the one-time activation secret from Vercel.";
      return;
    }
    button.disabled = true;
    message.textContent = "Verifying your account and activating Super Admin…";
    try {
      const idToken = await signedInUser.getIdToken();
      const response = await fetch("/api/bootstrap-super-admin", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + idToken,
          "x-bootstrap-secret": secret
        }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Activation failed.");
      await signedInUser.getIdToken(true);
      message.textContent = "Super Admin activated. Refreshing your portal…";
      $("#bootstrap-secret").value = "";
      setTimeout(() => location.reload(), 700);
    } catch (error) {
      message.textContent = error.message || "Activation failed. Please check the Vercel settings.";
      button.disabled = false;
    }
  });

  const authForm = $("#email-auth-form");
  const authModeToggle = $("#auth-mode-toggle");
  const emailSubmit = $("#email-submit");
  const emailInput = $("#auth-email");
  const passwordInput = $("#auth-password");

  authModeToggle.addEventListener("click", () => {
    authMode = authMode === "signin" ? "signup" : "signin";
    emailSubmit.textContent = authMode === "signin" ? "Sign in with email" : "Create account";
    authModeToggle.textContent = authMode === "signin" ? "Create an account" : "I already have an account";
    passwordInput.autocomplete = authMode === "signin" ? "current-password" : "new-password";
    authMessage.textContent = authMode === "signup" ? "Use an email address you can access. We'll send a verification link." : "";
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (password.length < 8) {
      authMessage.textContent = "Use a password with at least 8 characters.";
      return;
    }
    emailSubmit.disabled = true;
    authMessage.textContent = authMode === "signin" ? "Signing in securely…" : "Creating your account…";
    try {
      if (authMode === "signup") {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(credential.user);
        authMessage.textContent = "Account created. A verification link has been sent to " + email + ". You can now continue to the portal; verify your email to use account recovery and privileged setup.";
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      authMessage.textContent = friendlyError(error);
    } finally {
      emailSubmit.disabled = false;
    }
  });

  $("#forgot-password").addEventListener("click", async () => {
    const email = emailInput.value.trim();
    if (!email) {
      authMessage.textContent = "Enter your email address first, then select Forgot password.";
      emailInput.focus();
      return;
    }
    const resetButton = $("#forgot-password");
    resetButton.disabled = true;
    authMessage.textContent = "Sending password-reset email…";
    try {
      await sendPasswordResetEmail(auth, email);
      authMessage.textContent = "If an account exists for that address, Firebase has sent a password-reset link. Check your inbox and spam folder.";
    } catch (error) {
      authMessage.textContent = friendlyError(error);
    } finally {
      resetButton.disabled = false;
    }
  });

  $("#confirm-verification").addEventListener("click", async () => {
    if (!signedInUser) return;
    const button = $("#confirm-verification");
    button.disabled = true;
    try {
      await reload(signedInUser);
      if (!signedInUser.emailVerified) {
        authMessage.textContent = "Email is not verified yet. Open the verification link in your inbox, then try again.";
        return;
      }
      await signedInUser.getIdToken(true);
      location.reload();
    } catch (error) {
      authMessage.textContent = friendlyError(error);
    } finally {
      button.disabled = false;
    }
  });

  $("#resend-verification").addEventListener("click", async () => {
    if (!signedInUser) return;
    try {
      await sendEmailVerification(signedInUser);
      authMessage.textContent = "Verification email sent. Open the link, then sign out and sign in again.";
    } catch (error) {
      authMessage.textContent = friendlyError(error);
    }
  });

  $("#google-signin").addEventListener("click", async () => {
    authMessage.textContent = "Opening Google sign-in…";
    try { await signInWithPopup(auth, provider); }
    catch (error) { authMessage.textContent = friendlyError(error); }
  });
  $("#signout").addEventListener("click", () => signOut(auth));
  onAuthStateChanged(auth, async (user) => {
    signedInUser = user;
    if (!user) {
      portal.classList.add("hidden");
      authScreen.classList.remove("hidden");
      $("#bootstrap-panel").classList.add("hidden");
      $("#resend-verification").classList.add("hidden");
      $("#confirm-verification").classList.add("hidden");
      return;
    }
    try {
      const emailProvider = user.providerData.some((providerInfo) => providerInfo.providerId === "password");
      $("#resend-verification").classList.add("hidden");
      $("#confirm-verification").classList.add("hidden");
      if (emailProvider && !user.emailVerified) {
        authMessage.textContent = "You're signed in. You can verify your email later from your account inbox; portal access is available now.";
      }
      const token = await user.getIdTokenResult(true);
      const role = token.claims.role || "user";
      if (role !== "super_admin" && role !== "admin" && role !== "assistant" && role !== "user") {
        throw new Error("This account has an unrecognized access role.");
      }
      if (role === "user" && user.email === "shadowvybez001@gmail.com") {
        portal.classList.add("hidden");
        authScreen.classList.remove("hidden");
        $("#bootstrap-panel").classList.remove("hidden");
        authMessage.textContent = "Owner account verified. Complete the one-time activation below.";
        return;
      }
      currentRole = role;
      $("#staff-nav").classList.toggle("hidden", currentRole !== "super_admin");
      document.querySelectorAll(".nav[data-view='policies'], .nav[data-view='applications'], .nav[data-view='compliance'], .nav[data-view='activity']").forEach((el) => el.classList.toggle("hidden", currentRole === "user"));
      document.querySelectorAll(".nav[data-view='devices']").forEach((el) => el.classList.toggle("hidden", currentRole === "user"));
      document.querySelectorAll(".nav[data-view='overview']").forEach((el) => el.classList.toggle("hidden", currentRole === "user"));
      document.querySelectorAll(".nav[data-view='users']").forEach((el) => el.classList.toggle("hidden", !["super_admin", "admin"].includes(currentRole)));
      $("#bootstrap-panel").classList.add("hidden");
      authScreen.classList.add("hidden");
      portal.classList.remove("hidden");
      $("#avatar").textContent = (user.displayName || user.email || "A").slice(0, 1).toUpperCase();
      if (currentRole === "user") {
        document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
        $("#view-user-home").classList.remove("hidden");
        $("#page-title").textContent = "My account";
        await loadPersonalDashboard(user);
        $("#refresh-my-data").onclick = () => loadPersonalDashboard(user);
      } else {
        await loadDashboard();
        wireNavigation(db);
        wireAdminTools();
        wireEnrollmentCode(user, db);
      }
    } catch (error) {
      await signOut(auth);
      authMessage.textContent = friendlyError(error);
    }
  });
}

function friendlyError(error) {
  if (error?.code === "auth/unauthorized-domain") return "Add this Vercel domain to Firebase Authentication → Settings → Authorized domains.";
  if (error?.code === "auth/popup-closed-by-user") return "Sign-in was cancelled.";
  const messages = {
    "auth/email-already-in-use": "An account already exists for this email. Sign in instead.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/user-not-found": "No account was found for that email. Create an account first.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/weak-password": "Choose a stronger password with at least 8 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a little and try again.",
    "auth/network-request-failed": "Network connection failed. Check your internet and retry.",
    "auth/missing-password": "Enter your password."
  };
  return messages[error?.code] || error?.message || "Unable to sign in. Please try again.";
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
}
function date(value) {
  if (!value) return "—";
  const d = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
function pill(value) {
  const v = String(value || "unknown");
  const cls = ["enrolled", "compliant"].includes(v) ? "good" : v === "pending" ? "pending" : "";
  return '<span class="pill ' + cls + '">' + escapeHtml(v.replaceAll("_", " ")) + "</span>";
}
async function loadDashboard() {
  try {
    const token = await signedInUser.getIdToken();
    const response = await fetch("/api/admin-dashboard", { headers: { Authorization: "Bearer " + token } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load dashboard.");
    const devices = result.devices || [], policies = result.policies || [], activities = result.activities || [];
    $("#m-devices").textContent = devices.length;
    $("#m-enrolled").textContent = devices.filter((d) => d.enrollmentStatus === "enrolled").length;
    $("#m-compliant").textContent = devices.filter((d) => d.complianceStatus === "compliant").length;
    $("#m-policies").textContent = policies.filter((p) => p.enabled !== false).length;
    $("#nav-device-count").textContent = devices.length;
    const deviceRows = devices.length ? devices.map((d) => '<tr><td><b>' + escapeHtml(d.displayName || d.deviceName || "Unnamed device") + '</b><span class="subline">' + escapeHtml([d.manufacturer, d.model].filter(Boolean).join(" ")) + '</span></td><td>' + escapeHtml(d.model || "—") + '</td><td>' + pill(d.enrollmentStatus) + '</td><td>' + pill(d.assignmentStatus || "unassigned") + '</td><td>' + (Number.isFinite(d.batteryLevel) ? escapeHtml(d.batteryLevel) + "%" : "—") + '</td><td>' + date(d.lastSeenAt) + "</td></tr>").join("") : '<tr><td colspan="6" class="empty">No device records are available to this account.</td></tr>';
    $("#device-rows").innerHTML = deviceRows;
    const assignSelect = $("#assign-device-id");
    if (assignSelect) {
      const assignable = devices.filter((d) => d.enrollmentStatus === "enrolled" && d.assignmentStatus !== "active");
      assignSelect.innerHTML = '<option value="">Choose an unassigned enrolled device</option>' +
        assignable.map((d) => '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.displayName || d.model || d.id) + '</option>').join("");
      assignSelect.disabled = assignable.length === 0;
    }
    $("#compliance-rows").innerHTML = devices.length ? devices.map((d) => '<tr><td>' + escapeHtml(d.displayName || d.deviceName || "Unnamed device") + '</td><td>' + pill(d.enrollmentStatus) + '</td><td>' + pill(d.complianceStatus) + '</td><td>' + date(d.lastSeenAt) + '</td></tr>').join("") : '<tr><td colspan="4" class="empty">No device records available.</td></tr>';
    const activityHtml = activities.length ? activities.map((a) => '<div class="activity-row"><b>' + escapeHtml(a.action || "Activity") + '</b><span class="subline">' + escapeHtml(a.actorEmail || "Administrator") + " · " + date(a.createdAt) + "</span></div>").join("") : "No activity recorded yet.";
    $("#activity-preview").innerHTML = activityHtml;
    $("#activity-full").innerHTML = activityHtml;
    $("#policy-rows").textContent = policies.length ? policies.length + " policy record(s) found. Editing is not enabled in this release." : "No policy records available.";
  } catch (error) { showToast(error.message || "Unable to load dashboard data."); }
}
function showToast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3500);
}


async function loadPersonalDashboard(user) {
  const warning = $("#my-data-warning");
  try {
    const token = await user.getIdToken();
    const response = await fetch("/api/my-account-data", { headers: { Authorization: "Bearer " + token } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load your account data.");
    const devices = result.devices || [];
    const schedules = result.installments || [];
    const payments = result.payments || [];
    if (warning) { warning.classList.add("hidden"); warning.textContent = ""; }
    $("#my-device-count").textContent = devices.length;
    $("#my-schedule-count").textContent = schedules.length;
    $("#my-payment-count").textContent = payments.length;
    $("#my-role").textContent = "User";
    $("#my-device-list").innerHTML = devices.length
      ? devices.map((d) => '<div class="activity-row"><b>' + escapeHtml(d.displayName || d.model || "Assigned device") + '</b><span class="subline">Status: ' + escapeHtml(d.enrollmentStatus || "Not reported") + ' · Assignment: ' + escapeHtml(d.assignmentStatus || "active") + ' · Access: ' + escapeHtml(d.managementMode || "Unknown") + '</span><span class="subline">' + escapeHtml([d.manufacturer, d.model, d.androidVersion ? "Android " + d.androidVersion : ""].filter(Boolean).join(" · ")) + '</span><span class="subline">' + (Number.isFinite(d.batteryLevel) ? "Battery: " + escapeHtml(d.batteryLevel) + "%" + (d.isCharging ? " · Charging" : "") : "Battery: not reported") + '</span><span class="subline">Last seen: ' + date(d.lastSeenAt) + '</span></div>').join("")
      : "No company devices have been assigned to your account yet. Contact Z3X customer care if you believe this is incorrect.";
    const financeRows = schedules.map((d) => '<div class="activity-row"><b>' + escapeHtml(d.label || "Finance schedule") + '</b><span class="subline">' + escapeHtml(d.currencyCode || "KES") + " " + escapeHtml(d.amountMinor ?? "—") + '</span><span class="subline">Due: ' + date(d.dueDate) + '</span></div>')
      .concat(payments.map((d) => '<div class="activity-row"><b>Payment record</b><span class="subline">' + escapeHtml(d.currencyCode || "KES") + " " + escapeHtml(d.amountMinor ?? "—") + '</span><span class="subline">Paid: ' + date(d.paidAt) + '</span></div>'));
    $("#my-finance-list").innerHTML = financeRows.length ? financeRows.join("") : "No finance records are available yet.";
  } catch (error) {
    if (warning) { warning.classList.remove("hidden"); warning.textContent = error.message || "Unable to load your account data."; }
    $("#my-device-list").textContent = "Assigned device information is temporarily unavailable.";
    $("#my-finance-list").textContent = "Finance information is temporarily unavailable.";
  }
}

async function staffApi(method = "GET", body, pageToken) {
  if (!signedInUser) throw new Error("Please sign in again.");
  const token = await signedInUser.getIdToken();
  const url = new URL("/api/super-admin-users", window.location.origin);
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const response = await fetch(url, {
    method,
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Account request failed.");
  return result;
}
let accountPageToken = null;
let accountRows = [];

async function loadAccounts({ append = false } = {}) {
  const usersEl = $("#user-rows");
  const staffEl = $("#staff-rows");
  if (!usersEl || !staffEl || !["super_admin", "admin"].includes(currentRole)) return;
  if (!append) {
    accountPageToken = null;
    accountRows = [];
    usersEl.innerHTML = '<tr><td colspan="5" class="empty">Loading accounts…</td></tr>';
    staffEl.innerHTML = '<tr><td colspan="4" class="empty">Loading staff…</td></tr>';
  }
  try {
    const result = await staffApi("GET", undefined, append ? accountPageToken : undefined);
    accountRows = append ? accountRows.concat(result.users || []) : (result.users || []);
    accountPageToken = result.nextPageToken || null;
    const users = accountRows;
    const staff = users.filter((u) => ["super_admin", "admin", "assistant"].includes(u.role));
    usersEl.innerHTML = users.length ? users.map((u) => {
      const canToggle = currentRole === "super_admin" && u.uid !== signedInUser.uid && u.role !== "super_admin" && u.email !== "shadowvybez001@gmail.com";
      const action = canToggle
        ? '<button class="btn secondary" type="button" data-account-toggle data-uid="' + escapeHtml(u.uid) + '" data-disabled="' + String(Boolean(u.disabled)) + '">' + (u.disabled ? "Enable" : "Disable") + '</button>'
        : "—";
      return '<tr><td><b>' + escapeHtml(u.displayName || "Unnamed account") + '</b><span class="subline">' + escapeHtml(u.email) + '</span><span class="subline">' + escapeHtml(u.uid) + '</span></td><td>' + pill(u.role) + '</td><td>' + (u.disabled ? "Disabled" : "Enabled") + '</td><td>' + (u.emailVerified ? "Verified" : "Not verified") + '</td><td>' + date(u.lastSignInAt) + '</td><td>' + action + '</td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty">No accounts found.</td></tr>';
    staffEl.innerHTML = staff.length ? staff.map((u) => '<tr><td><b>' + escapeHtml(u.displayName || u.email) + '</b><span class="subline">' + escapeHtml(u.email) + '</span></td><td>' + pill(u.role) + '</td><td>' + (u.disabled ? "Disabled" : "Enabled") + '</td><td>' + date(u.lastSignInAt) + '</td></tr>').join("") : '<tr><td colspan="4" class="empty">No staff accounts assigned yet.</td></tr>';
    const more = $("#load-more-accounts");
    if (more) more.classList.toggle("hidden", !accountPageToken);
  } catch (error) {
    if (!append) {
      usersEl.innerHTML = '<tr><td colspan="6" class="empty">' + escapeHtml(error.message) + '</td></tr>';
      staffEl.innerHTML = '<tr><td colspan="4" class="empty">' + escapeHtml(error.message) + '</td></tr>';
    } else showToast(error.message);
  }
}


function wireAdminTools() {
  const usersTable = $("#user-rows");
  usersTable?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-account-toggle]");
    if (!button || currentRole !== "super_admin") return;
    const uid = button.dataset.uid;
    const currentlyDisabled = button.dataset.disabled === "true";
    const nextDisabled = !currentlyDisabled;
    if (!uid || !window.confirm((nextDisabled ? "Disable" : "Enable") + " this account?")) return;
    button.disabled = true;
    try {
      const result = await staffApi("POST", { uid, disabled: nextDisabled });
      showToast(result.message || "Account status updated.");
      await loadAccounts();
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
  const assignButton = $("#assign-device-submit");
  if (assignButton && !assignButton.dataset.wired) {
    assignButton.dataset.wired = "1";
    assignButton.addEventListener("click", async () => {
      const deviceId = $("#assign-device-id").value;
      const customerEmail = $("#assign-customer-email").value.trim();
      const message = $("#assign-device-message");
      if (!deviceId || !customerEmail) {
        message.textContent = "Choose an enrolled device and enter the customer's registered email.";
        return;
      }
      assignButton.disabled = true;
      message.textContent = "Verifying customer account and assigning device…";
      try {
        const token = await signedInUser.getIdToken();
        const response = await fetch("/api/assign-device-to-customer", {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, customerEmail })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Device assignment failed.");
        message.textContent = result.message;
        $("#assign-customer-email").value = "";
        await loadDashboard();
        showToast("Device assigned to " + result.customerEmail);
      } catch (error) {
        message.textContent = error.message || "Device assignment failed.";
      } finally {
        assignButton.disabled = false;
      }
    });
  }
  $("#refresh-users")?.addEventListener("click", loadAccounts);
  $("#refresh-staff")?.addEventListener("click", () => loadAccounts());
  $("#load-more-accounts")?.addEventListener("click", () => loadAccounts({ append: true }));
  $("#save-staff-role")?.addEventListener("click", async () => {
    const message = $("#staff-message");
    const button = $("#save-staff-role");
    const uid = $("#staff-uid").value.trim();
    const role = $("#staff-role").value;
    if (currentRole !== "super_admin") { message.textContent = "Only Super Admin can change staff roles."; return; }
    if (!uid) { message.textContent = "Enter the target Firebase Authentication UID."; return; }
    button.disabled = true;
    message.textContent = "Saving account role securely…";
    try {
      const result = await staffApi("POST", { uid, role });
      message.textContent = result.message;
      $("#staff-uid").value = "";
      await loadAccounts();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  if (["super_admin", "admin"].includes(currentRole)) loadAccounts();
}

function wireNavigation(db) {
  const sidebar = $("#portal-sidebar");
  const menuButton = $("#mobile-menu-toggle");
  const backdrop = $("#sidebar-backdrop");
  const closeMenu = () => {
    sidebar?.classList.remove("open");
    backdrop?.classList.remove("visible");
    menuButton?.setAttribute("aria-expanded", "false");
  };
  menuButton?.addEventListener("click", () => {
    const open = !sidebar.classList.contains("open");
    sidebar.classList.toggle("open", open);
    backdrop?.classList.toggle("visible", open);
    menuButton.setAttribute("aria-expanded", String(open));
  });
  backdrop?.addEventListener("click", closeMenu);
  document.querySelectorAll("[data-view], [data-go]").forEach((el) => {
    if (el.dataset.wired) return;
    el.dataset.wired = "1";
    el.addEventListener("click", () => {
      const name = el.dataset.view || el.dataset.go;
      document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
      $("#view-" + name)?.classList.remove("hidden");
      document.querySelectorAll(".nav").forEach((nav) => nav.classList.toggle("active", nav.dataset.view === name));
      const titles = { overview:"Overview", devices:"Devices", policies:"Policies", applications:"Applications", compliance:"Compliance", users:"User management", staff:"Staff management", activity:"Activity log" };
      $("#page-title").textContent = titles[name] || "Overview";
      closeMenu();
    });
  });
  $("#refresh").onclick = () => loadDashboard();
}


function wireEnrollmentCode(user, db) {
  // Customer accounts do not receive enrollment or unlink controls.
  document.querySelectorAll("[data-generate-enrollment-code]").forEach((button) => {
    if (button.dataset.wired) return;
    button.dataset.wired = "1";
    const panel = button.closest(".panel");
    const output = panel?.querySelector("[data-enrollment-code-result]");
    button.addEventListener("click", async () => {
      button.disabled = true;
      if (output) output.textContent = "Generating a secure one-time code…";
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/create-enrollment-code", {
          method: "POST",
          headers: { Authorization: "Bearer " + token }
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not create an enrollment code.");
        if (!output) throw new Error("Enrollment result area is missing.");
        output.innerHTML = '<div><b style="font-size:28px;letter-spacing:5px">' + escapeHtml(result.code) +
          '</b></div><p>Enter this code in the Z3X app on the device. It expires at ' +
          escapeHtml(new Date(result.expiresAt).toLocaleTimeString()) +
          ' and can only be used once by this account.</p><button class="btn secondary" data-copy-enrollment-code type="button">Copy code</button> <button class="btn secondary" data-revoke-enrollment-code type="button">Revoke code</button>';
        output.querySelector("[data-copy-enrollment-code]").addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(result.code); showToast("Enrollment code copied."); }
          catch { showToast("Copy is unavailable. You can select the code and copy it manually."); }
        });
        output.querySelector("[data-revoke-enrollment-code]").addEventListener("click", async (event) => {
          const revokeButton = event.currentTarget;
          if (!window.confirm("Revoke this code? Any device that has not used it will no longer be able to enroll with it.")) return;
          revokeButton.disabled = true;
          try {
            const revokeToken = await user.getIdToken();
            const revokeResponse = await fetch("/api/revoke-enrollment-code", {
              method: "POST",
              headers: { Authorization: "Bearer " + revokeToken, "Content-Type": "application/json" },
              body: JSON.stringify({ code: result.code })
            });
            const revokeResult = await revokeResponse.json();
            if (!revokeResponse.ok) throw new Error(revokeResult.error || "Could not revoke this code.");
            output.textContent = revokeResult.message || "Enrollment code revoked.";
          } catch (revokeError) {
            showToast(revokeError.message || "Code revocation failed.");
            revokeButton.disabled = false;
          }
        });
      } catch (error) {
        if (output) output.textContent = error.message || "Enrollment code generation failed.";
      } finally {
        button.disabled = false;
      }
    });
  });
}
