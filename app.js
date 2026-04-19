/* ==========================================================================
   BullBlack · app.js
   Firebase + Firestore + EmailJS + Google Calendar helpers
   ========================================================================== */

// ---------------------------------------------------------------------------
// 1. CONFIGURACIÓN — reemplaza con tus credenciales
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};

// Correo del administrador (BullBlack) — actualizar cuando lo tengas
const ADMIN_EMAIL = "admin@bullblack.cl"; // TODO: reemplazar

// EmailJS — https://www.emailjs.com (plan gratuito 200/mes)
const EMAILJS_CONFIG = {
  publicKey: "TU_EMAILJS_PUBLIC_KEY",
  serviceId: "TU_EMAILJS_SERVICE_ID",
  templateId: "TU_EMAILJS_TEMPLATE_ID"
};

// ---------------------------------------------------------------------------
// 2. INICIALIZACIÓN
// ---------------------------------------------------------------------------

// Valida si las credenciales aún son placeholders
const CONFIG_OK =
  firebaseConfig.apiKey &&
  !firebaseConfig.apiKey.startsWith("TU_") &&
  firebaseConfig.projectId &&
  !firebaseConfig.projectId.startsWith("TU_");

if (!CONFIG_OK) {
  console.error("⚠️ firebaseConfig tiene valores placeholder. Reemplaza con los datos reales de tu proyecto Firebase.");
}

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Inicializa EmailJS si está disponible
if (window.emailjs && EMAILJS_CONFIG.publicKey !== "TU_EMAILJS_PUBLIC_KEY") {
  emailjs.init(EMAILJS_CONFIG.publicKey);
}

// Mapea códigos de error de Firebase a mensajes claros en español
function traducirErrorFirebase(err) {
  const code = err?.code || "";
  const msg = err?.message || String(err);

  const mapa = {
    "auth/invalid-api-key":           "La API key de Firebase no es válida. Revisa firebaseConfig en app.js.",
    "auth/api-key-not-valid":         "La API key de Firebase no es válida. Revisa firebaseConfig en app.js.",
    "auth/invalid-credential":        "Correo o contraseña incorrectos.",
    "auth/wrong-password":            "Contraseña incorrecta.",
    "auth/user-not-found":            "No existe una cuenta con ese correo. Debes registrarte primero.",
    "auth/email-already-in-use":      "Ese correo ya está registrado. Intenta iniciar sesión.",
    "auth/weak-password":             "La contraseña es muy débil (mínimo 6 caracteres).",
    "auth/invalid-email":             "El correo ingresado no es válido.",
    "auth/too-many-requests":         "Demasiados intentos fallidos. Espera unos minutos.",
    "auth/network-request-failed":    "Sin conexión al servidor de Firebase. Revisa tu internet.",
    "auth/operation-not-allowed":     "El método Email/Password NO está habilitado. Ve a Firebase → Authentication → Sign-in method → Email/Password → Enable.",
    "auth/configuration-not-found":   "Firebase Authentication no está habilitado en tu proyecto. Ve a Firebase → Authentication → Get started.",
    "permission-denied":              "Firestore bloqueó la operación por reglas de seguridad. Revisa las reglas en Firebase → Firestore → Rules (ver README).",
    "unavailable":                    "Firestore no está disponible. ¿Creaste la base de datos en Firebase → Firestore → Create database?",
    "not-found":                      "No se encontró la base de datos de Firestore. Créala en Firebase → Firestore Database → Create database."
  };

  return mapa[code] || `${code ? `[${code}] ` : ""}${msg}`;
}

// ---------------------------------------------------------------------------
// 3. CONSTANTES
// ---------------------------------------------------------------------------
const HORARIO_INICIO = { h: 7, m: 30 };
const HORARIO_FIN    = { h: 20, m: 0 };
const INTERVALO_MIN  = 30;

const TIPOS_SERVICIO = {
  revision: "Revisión de sistema existente",
  implementacion: "Implementación de sistema nuevo",
  mantenimiento: "Mantenimiento preventivo",
  consulta: "Consulta técnica"
};

// ---------------------------------------------------------------------------
// 4. UTILIDADES DE TIEMPO / SLOTS
// ---------------------------------------------------------------------------
function generarSlots() {
  const slots = [];
  let h = HORARIO_INICIO.h;
  let m = HORARIO_INICIO.m;
  while (h < HORARIO_FIN.h || (h === HORARIO_FIN.h && m <= HORARIO_FIN.m)) {
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += INTERVALO_MIN;
    if (m >= 60) { m -= 60; h += 1; }
  }
  return slots;
}

function formatearFecha(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function fechaLegible(dateStr) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const fecha = new Date(y, mo - 1, d);
  return fecha.toLocaleDateString("es-CL", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
}

function esHoyOFuturo(dateStr) {
  const hoy = formatearFecha(new Date());
  return dateStr >= hoy;
}

function horaYaPaso(dateStr, hora) {
  const hoy = formatearFecha(new Date());
  if (dateStr > hoy) return false;
  if (dateStr < hoy) return true;
  const [h, m] = hora.split(":").map(Number);
  const ahora = new Date();
  return (h < ahora.getHours()) || (h === ahora.getHours() && m <= ahora.getMinutes());
}

// ---------------------------------------------------------------------------
// 5. REGISTRO / LOGIN
// ---------------------------------------------------------------------------

/**
 * Registra un cliente.
 * - email + password → Firebase Auth
 * - Guarda perfil en users/{uid} con displayName (nombre distintivo, único)
 * - Guarda índice nombresRegistrados/{displayName} → email para login por nombre
 */
async function registrarCliente({ email, password, displayName }) {
  const nombreNormalizado = displayName.trim();
  const nombreKey = nombreNormalizado.toLowerCase();

  console.log("[registro] 1/5 verificando nombre distintivo...");

  // Verificar unicidad del nombre distintivo
  try {
    const nombreDoc = await db.collection("nombresRegistrados").doc(nombreKey).get();
    if (nombreDoc.exists) {
      throw new Error("Ese nombre distintivo ya está en uso. Elige otro.");
    }
  } catch (e) {
    if (e.code === "permission-denied") {
      throw new Error("Firestore rechazó la lectura. Verifica las reglas (ver README). Código: permission-denied.");
    }
    if (!e.message?.includes("nombre distintivo")) {
      console.error("[registro] error verificando nombre:", e);
      throw new Error(traducirErrorFirebase(e));
    }
    throw e;
  }

  console.log("[registro] 2/5 creando cuenta en Firebase Auth...");

  // Crear usuario en Firebase Auth
  let cred;
  try {
    cred = await auth.createUserWithEmailAndPassword(email, password);
  } catch (e) {
    console.error("[registro] error Auth:", e);
    throw new Error(traducirErrorFirebase(e));
  }

  const uid = cred.user.uid;
  console.log("[registro] 3/5 usuario Auth creado:", uid);

  // A partir de aquí, si algo falla, limpiamos el usuario Auth para no dejar
  // una cuenta huérfana sin perfil
  try {
    await cred.user.updateProfile({ displayName: nombreNormalizado });

    console.log("[registro] 4/5 guardando perfil en Firestore...");

    // Determinar rol
    const rol = (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) ? "admin" : "cliente";

    await db.collection("users").doc(uid).set({
      email: email.toLowerCase(),
      displayName: nombreNormalizado,
      displayNameKey: nombreKey,
      rol,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    console.log("[registro] 5/5 guardando índice de nombre...");

    await db.collection("nombresRegistrados").doc(nombreKey).set({
      email: email.toLowerCase(),
      uid,
      displayName: nombreNormalizado
    });

    console.log("[registro] ✓ completo. Rol asignado:", rol);
    return cred.user;

  } catch (e) {
    console.error("[registro] Falló escritura en Firestore, eliminando cuenta Auth...", e);
    try { await cred.user.delete(); } catch (delErr) {
      console.error("[registro] No se pudo eliminar cuenta Auth:", delErr);
    }
    if (e.code === "permission-denied") {
      throw new Error("Firestore rechazó la escritura por reglas de seguridad. Copia las reglas del README en Firebase → Firestore → Rules → Publicar.");
    }
    if (e.code === "unavailable" || e.code === "not-found") {
      throw new Error("La base de datos Firestore no existe. Ve a Firebase → Firestore Database → Create database.");
    }
    throw new Error(traducirErrorFirebase(e));
  }
}

/**
 * Login flexible: acepta email o nombre distintivo + password.
 */
async function loginFlexible(identificador, password) {
  const id = identificador.trim();
  let email = id;

  console.log("[login] identificador:", id.includes("@") ? "correo" : "nombre distintivo");

  // Si no parece un email, buscarlo por nombre distintivo
  if (!id.includes("@")) {
    try {
      const snap = await db.collection("nombresRegistrados").doc(id.toLowerCase()).get();
      if (!snap.exists) {
        throw new Error("No existe un usuario con ese nombre distintivo.");
      }
      email = snap.data().email;
      console.log("[login] nombre resuelto a correo:", email);
    } catch (e) {
      if (e.message?.includes("nombre distintivo")) throw e;
      console.error("[login] error buscando nombre:", e);
      throw new Error(traducirErrorFirebase(e));
    }
  }

  try {
    return await auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    console.error("[login] error auth:", e);
    throw new Error(traducirErrorFirebase(e));
  }
}

async function logout() {
  await auth.signOut();
  window.location.href = "index.html";
}

async function getUserProfile(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

/**
 * Igual que getUserProfile pero espera hasta que el documento exista
 * (maneja la ventana entre createUserWithEmailAndPassword y la creación
 * del perfil en Firestore durante el registro).
 */
async function getUserProfileAwait(uid, maxIntentos = 12) {
  for (let i = 0; i < maxIntentos; i++) {
    const profile = await getUserProfile(uid);
    if (profile) return profile;
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

// ---------------------------------------------------------------------------
// 6. CITAS / RESERVAS
// ---------------------------------------------------------------------------

/**
 * Obtiene todas las citas activas (no canceladas) de una fecha.
 */
async function getCitasDeFecha(fecha) {
  const snap = await db.collection("citas")
    .where("fecha", "==", fecha)
    .get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => c.estado !== "cancelada");
}

/**
 * Crea una cita nueva.
 * Usa transacción para evitar dobles reservas del mismo slot.
 */
async function crearCita({ uid, displayName, email, fecha, hora, tipo, descripcion }) {
  const slotId = `${fecha}_${hora}`;
  const slotRef = db.collection("slotsTomados").doc(slotId);
  const citaRef = db.collection("citas").doc();

  await db.runTransaction(async (tx) => {
    const slotSnap = await tx.get(slotRef);
    if (slotSnap.exists) {
      throw new Error("Ese horario acaba de ser tomado por otro cliente. Elige otro.");
    }
    tx.set(slotRef, {
      citaId: citaRef.id,
      uid,
      fecha,
      hora,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    tx.set(citaRef, {
      uid, displayName, email, fecha, hora, tipo, descripcion,
      estado: "pendiente",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  });

  // Notificar al admin (email + link a Google Calendar)
  await notificarAdmin({ displayName, email, fecha, hora, tipo, descripcion });

  return citaRef.id;
}

async function getCitasDeUsuario(uid) {
  const snap = await db.collection("citas")
    .where("uid", "==", uid)
    .get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
}

async function getTodasLasCitas() {
  const snap = await db.collection("citas").get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
}

async function cancelarCita(citaId) {
  const citaRef = db.collection("citas").doc(citaId);
  const citaSnap = await citaRef.get();
  if (!citaSnap.exists) throw new Error("Cita no encontrada.");
  const cita = citaSnap.data();
  const slotId = `${cita.fecha}_${cita.hora}`;

  await db.runTransaction(async (tx) => {
    tx.update(citaRef, { estado: "cancelada" });
    tx.delete(db.collection("slotsTomados").doc(slotId));
  });
}

async function cambiarEstadoCita(citaId, nuevoEstado) {
  await db.collection("citas").doc(citaId).update({ estado: nuevoEstado });
}

// ---------------------------------------------------------------------------
// 7. GOOGLE CALENDAR — genera un link "Add to Google Calendar"
// ---------------------------------------------------------------------------
function generarLinkCalendar({ displayName, email, fecha, hora, tipo, descripcion }) {
  const [y, mo, d] = fecha.split("-").map(Number);
  const [h, m] = hora.split(":").map(Number);

  const inicio = new Date(y, mo - 1, d, h, m);
  const fin = new Date(inicio.getTime() + INTERVALO_MIN * 60 * 1000);

  const fmt = (dt) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
  };

  const titulo = `BullBlack · ${TIPOS_SERVICIO[tipo] || tipo} — ${displayName}`;
  const detalles = [
    `Cliente: ${displayName}`,
    `Correo: ${email}`,
    `Tipo: ${TIPOS_SERVICIO[tipo] || tipo}`,
    `Descripción: ${descripcion || "(sin detalle)"}`
  ].join("\n");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: titulo,
    dates: `${fmt(inicio)}/${fmt(fin)}`,
    details: detalles,
    ctz: "America/Santiago"
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// 8. EMAIL AL ADMIN (vía EmailJS)
// ---------------------------------------------------------------------------
async function notificarAdmin(cita) {
  const calendarLink = generarLinkCalendar(cita);

  // Si EmailJS no está configurado aún, solo loguea
  if (!window.emailjs || EMAILJS_CONFIG.publicKey === "TU_EMAILJS_PUBLIC_KEY") {
    console.warn("EmailJS no configurado. Datos de notificación:", { ...cita, calendarLink });
    return;
  }

  try {
    await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
      to_email: ADMIN_EMAIL,
      cliente: cita.displayName,
      cliente_email: cita.email,
      fecha: fechaLegible(cita.fecha),
      hora: cita.hora,
      tipo: TIPOS_SERVICIO[cita.tipo] || cita.tipo,
      descripcion: cita.descripcion || "(sin detalle)",
      calendar_link: calendarLink
    });
  } catch (err) {
    console.error("Error enviando email:", err);
    // No bloqueamos la reserva si el email falla
  }
}

// ---------------------------------------------------------------------------
// 9. AUTH GUARD helpers
// ---------------------------------------------------------------------------
function requireAuth(callback) {
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    const profile = await getUserProfileAwait(user.uid);
    callback(user, profile);
  });
}

function requireAdmin(callback) {
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    const profile = await getUserProfileAwait(user.uid);
    if (!profile || profile.rol !== "admin") {
      alert("Acceso restringido: se requieren permisos de administrador.");
      window.location.href = "reservar.html";
      return;
    }
    callback(user, profile);
  });
}

// ---------------------------------------------------------------------------
// 10. UI helpers
// ---------------------------------------------------------------------------
function mostrarAlerta(el, mensaje, tipo = "error") {
  el.innerHTML = `<div class="alert alert-${tipo}">${mensaje}</div>`;
}
function limpiarAlerta(el) { el.innerHTML = ""; }

function renderBadge(estado) {
  const labels = {
    pendiente: "Pendiente",
    confirmada: "Confirmada",
    cancelada: "Cancelada",
    completada: "Completada"
  };
  return `<span class="badge badge-${estado}">${labels[estado] || estado}</span>`;
}
