// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(registration => {
        console.log('ServiceWorker terdaftar dengan sukses. Scope:', registration.scope);
      })
      .catch(error => {
        console.log('Pendaftaran ServiceWorker gagal:', error);
      });
  });
}

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCm5LHJFZzWmch85lBMBmkJ-PhKh_h4Ymw",
  authDomain: "akses-struk-spbu.firebaseapp.com",
  projectId: "akses-struk-spbu",
  storageBucket: "akses-struk-spbu.firebasestorage.app",
  messagingSenderId: "1062780755149",
  appId: "1:1062780755149:web:08d8a261824553366bdd84",
  measurementId: "G-2W8XJJ7TDF"
};

const OWNER_EMAIL = "admin3441103@strukspbu.com";
const STATUS_CONFIG = {
  ACTIVE: { label: "Aktif", tone: "success" },
  DISABLED: { label: "Nonaktif", tone: "warning" },
  BLOCKED: { label: "Diblokir", tone: "danger" },
  REMOVED: { label: "Dicabut", tone: "neutral" },
  UNKNOWN: { label: "Tidak diketahui", tone: "neutral" }
};

const state = {
  devices: [],
  unsubscribe: null,
  processing: false,
  pendingAction: null
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  [
    "login-view", "dashboard-view", "login-form", "login-message", "login-button",
    "admin-email", "admin-password", "admin-email-label", "logout-button",
    "connection-indicator", "connection-text", "device-list", "device-total",
    "dashboard-message", "device-search", "status-filter", "action-overlay",
    "modal-icon", "modal-title", "modal-description", "modal-device", "modal-error",
    "modal-actions", "modal-cancel", "modal-confirm", "modal-processing", "processing-text"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  els["login-form"].addEventListener("submit", (event) => {
    event.preventDefault();
    loginAdmin();
  });
  els["logout-button"].addEventListener("click", logoutAdmin);
  els["device-search"].addEventListener("input", renderDevices);
  els["status-filter"].addEventListener("change", renderDevices);
  els["modal-cancel"].addEventListener("click", closeModal);
  els["modal-confirm"].addEventListener("click", confirmAction);
  els["device-list"].addEventListener("click", handleDeviceAction);

  initAuth();
});

function getFirebaseServices() {
  if (typeof firebase === "undefined") {
    throw new Error("Firebase SDK belum tersedia. Periksa koneksi internet.");
  }
  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
  return { auth: firebase.auth(), db: firebase.firestore() };
}

function initAuth() {
  try {
    const { auth } = getFirebaseServices();
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        stopDeviceListener();
        showLogin();
        return;
      }

      if ((user.email || "").toLowerCase() !== OWNER_EMAIL) {
        await auth.signOut();
        showLogin("Akun ini tidak memiliki hak admin.", "error");
        return;
      }

      showDashboard(user.email);
      startDeviceListener();
    });
  } catch (error) {
    showLogin(error.message, "error");
  }
}

async function loginAdmin() {
  const email = els["admin-email"].value.trim();
  const password = els["admin-password"].value;

  if (!email || !password) {
    showLogin("Email dan password wajib diisi.", "error");
    return;
  }
  if (email.toLowerCase() !== OWNER_EMAIL) {
    showLogin("Akun ini tidak memiliki hak admin.", "error");
    return;
  }

  setLoginBusy(true);
  showLogin("Memverifikasi akun admin...", "info");
  try {
    const { auth } = getFirebaseServices();
    await auth.signInWithEmailAndPassword(email, password);
    els["admin-password"].value = "";
    els["login-message"].textContent = ""; // Perbaikan: Langsung menghapus teks tanpa mengubah view agar transisi dashboard terlihat mulus
    els["login-message"].classList.remove("is-info", "is-error");
  } catch (error) {
    showLogin(mapAuthError(error), "error");
  } finally {
    setLoginBusy(false);
  }
}

async function logoutAdmin() {
  const { auth } = getFirebaseServices();
  await auth.signOut();
}

function startDeviceListener() {
  if (state.unsubscribe) return;
  setConnection("loading", "Menghubungkan ke Firestore...");

  try {
    const { db } = getFirebaseServices();
    state.unsubscribe = db.collection("deviceRecords").onSnapshot((snapshot) => {
      state.devices = snapshot.docs.map((doc) => normalizeDevice(doc.id, doc.data()));
      updateSummary();
      renderDevices();
      setConnection("live", "Data real-time aktif");
      showDashboardMessage("");
    }, (error) => {
      setConnection("error", "Koneksi Firestore gagal");
      showDashboardMessage(mapFirestoreError(error));
      renderMessageState("Data perangkat tidak dapat dimuat.");
    });
  } catch (error) {
    setConnection("error", "Firebase belum siap");
    showDashboardMessage(error.message);
  }
}

function stopDeviceListener() {
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = null;
  state.devices = [];
}

function normalizeDevice(id, data) {
  const status = String(data.status || "UNKNOWN").toUpperCase();
  return {
    id,
    operatorName: data.lastOperatorName || data.operatorName || "—",
    deviceName: data.deviceName || data.model || "Belum tersedia",
    sessionId: data.sessionId || "Belum tersedia",
    sessionStartedAt: data.sessionStartedAt || data.lastLoginAt || null,
    status: STATUS_CONFIG[status] ? status : "UNKNOWN",
    registeredAt: data.registeredAt || null,
    lastLoginAt: data.lastLoginAt || null,
    raw: data
  };
}

function updateSummary() {
  const counts = { ACTIVE: 0, DISABLED: 0, BLOCKED: 0, REMOVED: 0 };
  state.devices.forEach((device) => {
    if (counts[device.status] !== undefined) counts[device.status] += 1;
  });
  document.getElementById("count-active").textContent = counts.ACTIVE;
  document.getElementById("count-disabled").textContent = counts.DISABLED;
  document.getElementById("count-blocked").textContent = counts.BLOCKED;
  document.getElementById("count-removed").textContent = counts.REMOVED;
  els["device-total"].textContent = `${state.devices.length} perangkat`;
}

function renderDevices() {
  const query = els["device-search"].value.trim().toLowerCase();
  const filter = els["status-filter"].value;
  const devices = state.devices
    .filter((device) => filter === "ALL" || device.status === filter)
    .filter((device) => !query || `${device.id} ${device.operatorName} ${device.deviceName}`.toLowerCase().includes(query))
    .sort((a, b) => timestampValue(b.registeredAt) - timestampValue(a.registeredAt));

  if (!devices.length) {
    renderMessageState(state.devices.length ? "Tidak ada perangkat yang cocok dengan pencarian atau filter." : "Belum ada perangkat terdaftar.");
    return;
  }

  els["device-list"].replaceChildren();
  devices.forEach((device) => els["device-list"].append(createDeviceCard(device)));
}

function createDeviceCard(device) {
  const card = document.createElement("article");
  card.className = "device-card";
  const config = STATUS_CONFIG[device.status] || { label: device.status, tone: "neutral" };
  const toggle = device.status === "ACTIVE"
    ? { status: "DISABLED", label: "Nonaktifkan", className: "button-warning" }
    : { status: "ACTIVE", label: "Aktifkan Kembali", className: "button-success" };

  card.innerHTML = `
    <div class="device-details">
      <div class="device-detail"><span class="detail-label">Device Id :</span><span class="detail-value device-id"></span></div>
      <div class="device-detail"><span class="detail-label">Nama operator :</span><span class="detail-value device-operator"></span></div>
      <div class="device-detail"><span class="detail-label">Nama perangkat :</span><span class="detail-value device-name"></span></div>
      <div class="device-detail"><span class="detail-label">Sesi Login :</span><span class="detail-value device-session"></span></div>
      <div class="device-detail"><span class="detail-label">Status :</span><span class="detail-value"><span class="status-badge status-${escapeHtml(device.status)} device-status"></span></span></div>
      <p class="device-last-seen"></p>
    </div>
    <div class="device-side">
      <div class="actions">
        <button class="button button-secondary" type="button" data-action="REMOVED">Hapus Perangkat</button>
        <button class="button button-danger" type="button" data-action="BLOCKED">Blokir Perangkat</button>
        <button class="button ${toggle.className}" type="button" data-action="${toggle.status}">${toggle.label}</button>
      </div>
    </div>`;

  card.querySelector(".device-id").textContent = device.id;
  card.querySelector(".device-operator").textContent = device.operatorName;
  card.querySelector(".device-name").textContent = device.deviceName;
  card.querySelector(".device-session").textContent = device.sessionId === "Belum tersedia"
    ? "Belum tersedia"
    : `${device.sessionId} · ${formatTimestamp(device.sessionStartedAt)}`;
  card.querySelector(".device-status").textContent = config.label;
  card.querySelector(".device-last-seen").textContent =
    `Terdaftar: ${formatTimestamp(device.registeredAt)} · Login terakhir: ${formatTimestamp(device.lastLoginAt)}`;
  card.querySelectorAll("button[data-action]").forEach((button) => {
    button.dataset.deviceId = device.id;
  });
  return card;
}

function handleDeviceAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || state.processing) return;
  const device = state.devices.find((item) => item.id === button.dataset.deviceId);
  if (!device) return;
  openConfirmation(device, button.dataset.action);
}

function openConfirmation(device, nextStatus) {
  const actionText = {
    REMOVED: ["Hapus perangkat", "Mencabut akses dan menghapus perangkat...", "Hapus Perangkat"],
    BLOCKED: ["Blokir perangkat", "Memblokir perangkat...", "Blokir Perangkat"],
    DISABLED: ["Nonaktifkan perangkat", "Menonaktifkan perangkat...", "Nonaktifkan"],
    ACTIVE: ["Aktifkan kembali perangkat", "Mengaktifkan kembali perangkat...", "Aktifkan Kembali"]
  }[nextStatus];

  state.pendingAction = { deviceId: device.id, nextStatus, processingText: actionText[1] };
  els["modal-title"].textContent = `${actionText[0]}?`;
  els["modal-description"].textContent = "Perubahan ini akan diterapkan ke Firestore. Jika perangkat sedang terhubung, status akses akan dipantau secara real-time oleh aplikasi.";
  els["modal-device"].innerHTML = `<strong></strong><br><span></span>`;
  els["modal-device"].querySelector("strong").textContent = device.id;
  els["modal-device"].querySelector("span").textContent = `Operator: ${device.operatorName} · Status saat ini: ${STATUS_CONFIG[device.status]?.label || device.status}`;
  els["modal-confirm"].textContent = actionText[2];
  els["modal-confirm"].className = `button ${nextStatus === "ACTIVE" ? "button-success" : nextStatus === "DISABLED" ? "button-warning" : "button-danger"}`;
  els["modal-icon"].className = `modal-icon ${nextStatus === "ACTIVE" ? "is-success" : nextStatus === "DISABLED" ? "is-warning" : ""}`;
  els["modal-error"].textContent = "";
  setModalProcessing(false);
  els["action-overlay"].hidden = false;
  els["action-overlay"].setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  els["modal-cancel"].focus();
}

async function confirmAction() {
  if (!state.pendingAction || state.processing) return;
  const { deviceId, nextStatus, processingText } = state.pendingAction;
  state.processing = true;
  setModalProcessing(true, processingText);

  try {
    const { db, auth } = getFirebaseServices();
    await db.collection("deviceRecords").doc(deviceId).update({
      status: nextStatus,
      statusUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      statusUpdatedBy: auth.currentUser ? auth.currentUser.email : OWNER_EMAIL,
      statusReason: `Diubah melalui Admin App menjadi ${nextStatus}`
    });
    
    // Perbaikan: Sistem mengizinkan close modal jika state.processing disetel kembali ke false
    state.processing = false; 
    closeModal();
    showDashboardMessage("Status perangkat berhasil diperbarui.", "success");
  } catch (error) {
    els["modal-error"].textContent = mapFirestoreError(error);
    setModalProcessing(false);
    state.processing = false;
  }
}

function closeModal() {
  if (state.processing) return;
  state.pendingAction = null;
  els["action-overlay"].hidden = true;
  els["action-overlay"].setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function setModalProcessing(active, text) {
  els["modal-actions"].hidden = active;
  els["modal-processing"].hidden = !active;
  if (text) els["processing-text"].textContent = text;
  els["action-overlay"].style.pointerEvents = "auto";
}

function showLogin(message, type) {
  els["dashboard-view"].hidden = true;
  els["login-view"].hidden = false;
  if (message !== undefined) {
    els["login-message"].textContent = message || "";
    els["login-message"].classList.toggle("is-info", type === "info");
  }
}

function showDashboard(email) {
  els["login-view"].hidden = true;
  els["dashboard-view"].hidden = false;
  els["admin-email-label"].textContent = email;
}

function setLoginBusy(busy) {
  els["login-button"].disabled = busy;
  els["login-button"].textContent = busy ? "Memverifikasi..." : "Masuk ke Dashboard";
}

function setConnection(stateName, text) {
  els["connection-indicator"].className = `connection-status is-${stateName}`;
  els["connection-text"].textContent = text;
}

function showDashboardMessage(message) {
  els["dashboard-message"].textContent = message || "";
}

function renderMessageState(message) {
  els["device-list"].replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "list-state";
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  wrap.append(paragraph);
  els["device-list"].append(wrap);
}

function formatTimestamp(value) {
  const millis = timestampValue(value);
  if (!millis) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(millis));
}

function timestampValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapAuthError(error) {
  const code = error && error.code;
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Email atau password admin salah.";
  }
  if (code === "auth/too-many-requests") return "Terlalu banyak percobaan. Coba lagi nanti.";
  if (code === "auth/network-request-failed") return "Tidak dapat terhubung ke Firebase. Periksa koneksi internet.";
  return "Login admin gagal. Periksa akun Firebase Authentication.";
}

function mapFirestoreError(error) {
  if (error && error.code === "permission-denied") {
    return "Firestore menolak perubahan. Pastikan Security Rules mengizinkan akun admin ini.";
  }
  return "Gagal memperbarui Firestore. Perubahan belum diterapkan.";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}
