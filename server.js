require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { promisify } = require("node:util");
const { createPool } = require("mysql2/promise");

const pbkdf2 = promisify(crypto.pbkdf2);
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const ITERACIONES_HASH = 100000;
const DURACION_SESION_MS = 8 * 60 * 60 * 1000;
const COOKIE_SESION = "profedisponible_sesion";
const sesiones = new Map();
const intentosLogin = new Map();
const rutasEstaticas = new Set(["/", "/index.html"]);
const carpetasEstaticas = ["/Pantalla/", "/Design/", "/Control/", "/Informacion/"];
const tiposContenido = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
};

const limpiezaSesiones = setInterval(() => {
    const ahora = Date.now();
    for (const [id, sesion] of sesiones) {
        if (sesion.vence <= ahora) {
            sesiones.delete(id);
        }
    }
    for (const [llave, estado] of intentosLogin) {
        if (estado.bloqueadoHasta && estado.bloqueadoHasta <= ahora) {
            intentosLogin.delete(llave);
        }
    }
}, 60 * 1000);
limpiezaSesiones.unref();

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT debe ser un puerto válido.");
}

const pool = createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || "profedisponible",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4"
});

function enviarJson(respuesta, estado, datos, encabezadosAdicionales) {
    respuesta.writeHead(estado, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...encabezadosAdicionales
    });
    respuesta.end(JSON.stringify(datos));
}

function leerJson(solicitud) {
    return new Promise((resolve, reject) => {
        let cuerpo = "";
        let excedido = false;

        solicitud.on("data", (fragmento) => {
            if (excedido) {
                return;
            }
            cuerpo += fragmento;
            if (Buffer.byteLength(cuerpo) > 16384) {
                excedido = true;
                const error = new Error("La solicitud es demasiado grande.");
                error.statusCode = 413;
                reject(error);
            }
        });

        solicitud.on("end", () => {
            if (excedido) {
                return;
            }
            try {
                resolve(JSON.parse(cuerpo));
            } catch {
                const error = new Error("El formato de la solicitud no es válido.");
                error.statusCode = 400;
                reject(error);
            }
        });

        solicitud.on("error", reject);
    });
}

function cookieValor(solicitud, nombre) {
    const cookies = (solicitud.headers.cookie || "").split(";");
    for (const cookie of cookies) {
        const separador = cookie.indexOf("=");
        if (separador >= 0 && cookie.slice(0, separador).trim() === nombre) {
            return cookie.slice(separador + 1).trim();
        }
    }
    return null;
}

function crearCookieSesion(solicitud, id) {
    const segura = solicitud.socket.encrypted ? "; Secure" : "";
    return `${COOKIE_SESION}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${segura}`;
}

function crearSesion(solicitud, respuesta, usuario) {
    const id = crypto.randomBytes(32).toString("hex");
    sesiones.set(id, {
        usuario: { ...usuario },
        vence: Date.now() + DURACION_SESION_MS
    });
    respuesta.setHeader("Set-Cookie", crearCookieSesion(solicitud, id));
    return sesiones.get(id).usuario;
}

function obtenerSesion(solicitud) {
    const id = cookieValor(solicitud, COOKIE_SESION);
    const sesion = id && sesiones.get(id);
    if (!sesion) {
        return null;
    }
    if (sesion.vence <= Date.now()) {
        sesiones.delete(id);
        return null;
    }
    return sesion.usuario;
}

function mismaOrigen(solicitud) {
    const origen = solicitud.headers.origin;
    if (!origen) {
        return true;
    }
    try {
        return new URL(origen).host === solicitud.headers.host;
    } catch {
        return false;
    }
}

async function calcularHash(contrasena, sal, iteraciones) {
    return pbkdf2(contrasena, Buffer.from(sal, "hex"), iteraciones, 32, "sha256");
}

function llaveIntento(solicitud, usuario) {
    return `${solicitud.socket.remoteAddress || "desconocido"}:${usuario}`;
}

function obtenerBloqueo(llave) {
    const estado = intentosLogin.get(llave);
    if (!estado) {
        return 0;
    }
    if (estado.bloqueadoHasta <= Date.now()) {
        if (estado.bloqueadoHasta) {
            intentosLogin.delete(llave);
        }
        return 0;
    }
    return Math.ceil((estado.bloqueadoHasta - Date.now()) / 1000);
}

function registrarIntentoFallido(llave) {
    if (!intentosLogin.has(llave) && intentosLogin.size >= 10000) {
        const ahora = Date.now();
        for (const [clave, estado] of intentosLogin) {
            if (!estado.bloqueadoHasta || estado.bloqueadoHasta <= ahora) {
                intentosLogin.delete(clave);
            }
        }
        if (intentosLogin.size >= 10000) {
            intentosLogin.delete(intentosLogin.keys().next().value);
        }
    }

    const estado = intentosLogin.get(llave) || { fallos: 0, bloqueadoHasta: 0 };
    estado.fallos += 1;
    if (estado.fallos >= 3) {
        estado.fallos = 0;
        estado.bloqueadoHasta = Date.now() + 30 * 1000;
    }
    intentosLogin.set(llave, estado);
}

function respuestaUsuario(usuario) {
    return {
        id: Number(usuario.id),
        usuario: usuario.usuario,
        nombre: usuario.nombre || usuario.usuario,
        rol: usuario.rol
    };
}

async function iniciarSesion(solicitud, respuesta) {
    const datos = await leerJson(solicitud);
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
        enviarJson(respuesta, 400, { error: "El formato de la solicitud no es válido." });
        return;
    }
    const usuario = typeof datos.usuario === "string" ? datos.usuario.trim().toLowerCase() : "";
    const contrasena = typeof datos.contrasena === "string" ? datos.contrasena : "";
    const rol = typeof datos.rol === "string" ? datos.rol : "";

    if (!usuario || !contrasena || usuario.length > 50 || contrasena.length > 128) {
        enviarJson(respuesta, 400, { error: "Ingresa un usuario y una contraseña válidos." });
        return;
    }

    const llave = llaveIntento(solicitud, usuario);
    const espera = obtenerBloqueo(llave);
    if (espera > 0) {
        enviarJson(respuesta, 429, {
            error: `Demasiados intentos. Espera ${espera} segundos antes de volver a intentar.`
        });
        return;
    }

    const [filas] = await pool.execute(
        "SELECT id, nombre, usuario, rol, sal, hash_contrasena, iteraciones_hash, activo FROM usuarios WHERE usuario = ? LIMIT 1",
        [usuario]
    );
    const registro = filas[0];
    const sal = registro ? registro.sal : "00000000000000000000000000000000";
    const iteraciones = registro ? Number(registro.iteraciones_hash) : ITERACIONES_HASH;
    const iteracionesValidas = Number.isInteger(iteraciones) && iteraciones >= 10000 && iteraciones <= 1000000;
    const hashCalculado = await calcularHash(
        contrasena,
        sal,
        iteracionesValidas ? iteraciones : ITERACIONES_HASH
    );
    const hashGuardado = registro && /^[a-f0-9]{64}$/i.test(registro.hash_contrasena)
        ? Buffer.from(registro.hash_contrasena, "hex")
        : Buffer.alloc(32);
    const hashCorrecto = hashGuardado.length === hashCalculado.length
        && crypto.timingSafeEqual(hashCalculado, hashGuardado);
    const credencialesCorrectas = Boolean(
        registro
        && registro.activo
        && iteracionesValidas
        && hashCorrecto
        && (!rol || registro.rol === rol)
    );

    if (!credencialesCorrectas) {
        registrarIntentoFallido(llave);
        enviarJson(respuesta, 401, { error: "Usuario o contraseña incorrectos." });
        return;
    }

    intentosLogin.delete(llave);
    const user = respuestaUsuario(registro);
    crearSesion(solicitud, respuesta, user);
    enviarJson(respuesta, 200, { user });
}

async function registrarUsuario(solicitud, respuesta) {
    const datos = await leerJson(solicitud);
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
        enviarJson(respuesta, 400, { error: "El formato de la solicitud no es válido." });
        return;
    }
    const nombre = typeof datos.nombre === "string" ? datos.nombre.trim() : "";
    const correo = typeof datos.correo === "string" ? datos.correo.trim().toLowerCase() : "";
    const usuario = typeof datos.usuario === "string" ? datos.usuario.trim().toLowerCase() : "";
    const rol = datos.rol;
    const contrasena = typeof datos.contrasena === "string" ? datos.contrasena : "";

    if (!nombre || nombre.length > 120) {
        enviarJson(respuesta, 400, { error: "Ingresa un nombre de hasta 120 caracteres." });
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || correo.length > 254) {
        enviarJson(respuesta, 400, { error: "Ingresa un correo electrónico válido." });
        return;
    }
    if (!/^[a-z0-9._-]{3,50}$/.test(usuario)) {
        enviarJson(respuesta, 400, {
            error: "El usuario debe tener entre 3 y 50 caracteres: letras, números, punto, guion o guion bajo."
        });
        return;
    }
    if (rol !== "estudiante" && rol !== "profesor") {
        enviarJson(respuesta, 400, { error: "Selecciona un tipo de usuario válido." });
        return;
    }
    if (contrasena.length < 8 || contrasena.length > 128) {
        enviarJson(respuesta, 400, { error: "La contraseña debe tener entre 8 y 128 caracteres." });
        return;
    }

    const sal = crypto.randomBytes(16).toString("hex");
    const hash = (await calcularHash(contrasena, sal, ITERACIONES_HASH)).toString("hex");

    try {
        const [resultado] = await pool.execute(
            "INSERT INTO usuarios (nombre, correo, usuario, rol, sal, hash_contrasena, iteraciones_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [nombre, correo, usuario, rol, sal, hash, ITERACIONES_HASH]
        );
        const user = respuestaUsuario({ id: resultado.insertId, nombre, usuario, rol });
        crearSesion(solicitud, respuesta, user);
        enviarJson(respuesta, 201, { user });
        return;
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            enviarJson(respuesta, 409, { error: "Ese usuario o correo ya está registrado." });
            return;
        }
        throw error;
    }
}

function obtenerSesionRequerida(solicitud, respuesta, rolesPermitidos) {
    const user = obtenerSesion(solicitud);
    if (!user) {
        enviarJson(respuesta, 401, { error: "Inicia sesión para continuar." });
        return null;
    }
    if (rolesPermitidos && !rolesPermitidos.includes(user.rol)) {
        enviarJson(respuesta, 403, { error: "No tienes permiso para realizar esta acción." });
        return null;
    }
    return user;
}

function formatoHoraValido(valor) {
    return typeof valor === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(valor);
}

function minutosHora(valor) {
    const [hora, minuto] = valor.split(":").map(Number);
    return hora * 60 + minuto;
}

function formatoFechaValido(valor) {
    if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        return false;
    }
    const fecha = new Date(`${valor}T00:00:00`);
    return !Number.isNaN(fecha.getTime())
        && fecha.getFullYear() === Number(valor.slice(0, 4))
        && fecha.getMonth() + 1 === Number(valor.slice(5, 7))
        && fecha.getDate() === Number(valor.slice(8, 10));
}

async function consultarDisponibilidades(solicitud, respuesta, url) {
    const user = obtenerSesionRequerida(solicitud, respuesta);
    if (!user) {
        return;
    }

    let filtro = "WHERE d.activa = 1 AND u.activo = 1";
    const parametros = [];
    if (user.rol === "profesor") {
        filtro += " AND d.profesor_id = ?";
        parametros.push(user.id);
    } else if (url.searchParams.has("profesor")) {
        const profesorId = Number(url.searchParams.get("profesor"));
        if (!Number.isSafeInteger(profesorId) || profesorId < 1) {
            enviarJson(respuesta, 400, { error: "El profesor seleccionado no es válido." });
            return;
        }
        filtro += " AND d.profesor_id = ?";
        parametros.push(profesorId);
    }

    const [filas] = await pool.execute(
        `SELECT d.id, d.profesor_id, COALESCE(NULLIF(u.nombre, ''), u.usuario) AS profesor_nombre, d.dia_semana,
                TIME_FORMAT(d.hora_inicio, '%H:%i') AS hora_inicio,
                TIME_FORMAT(d.hora_fin, '%H:%i') AS hora_fin
         FROM disponibilidades d
         JOIN usuarios u ON u.id = d.profesor_id
         ${filtro}
         ORDER BY u.nombre, d.dia_semana, d.hora_inicio`,
        parametros
    );
    enviarJson(respuesta, 200, { disponibilidades: filas });
}

async function crearDisponibilidad(solicitud, respuesta) {
    const user = obtenerSesionRequerida(solicitud, respuesta, ["profesor"]);
    if (!user) {
        return;
    }

    const datos = await leerJson(solicitud);
    const dia = Number(datos && datos.dia_semana);
    const inicio = datos && datos.hora_inicio;
    const fin = datos && datos.hora_fin;
    if (!Number.isInteger(dia) || dia < 1 || dia > 7
        || !formatoHoraValido(inicio) || !formatoHoraValido(fin)
        || minutosHora(fin) - minutosHora(inicio) < 30) {
        enviarJson(respuesta, 400, { error: "Selecciona un día y un horario válido de al menos 30 minutos." });
        return;
    }

    const [solapamientos] = await pool.execute(
        `SELECT id FROM disponibilidades
         WHERE profesor_id = ? AND dia_semana = ? AND activa = 1
           AND hora_inicio < ? AND hora_fin > ?
         LIMIT 1`,
        [user.id, dia, fin, inicio]
    );
    if (solapamientos.length) {
        enviarJson(respuesta, 409, { error: "Ese horario se cruza con otra disponibilidad tuya." });
        return;
    }

    const [resultado] = await pool.execute(
        "INSERT INTO disponibilidades (profesor_id, dia_semana, hora_inicio, hora_fin) VALUES (?, ?, ?, ?)",
        [user.id, dia, `${inicio}:00`, `${fin}:00`]
    );
    enviarJson(respuesta, 201, { id: resultado.insertId });
}

async function desactivarDisponibilidad(solicitud, respuesta, id) {
    const user = obtenerSesionRequerida(solicitud, respuesta, ["profesor"]);
    if (!user) {
        return;
    }
    const [resultado] = await pool.execute(
        "UPDATE disponibilidades SET activa = 0 WHERE id = ? AND profesor_id = ? AND activa = 1",
        [id, user.id]
    );
    if (!resultado.affectedRows) {
        enviarJson(respuesta, 404, { error: "No se encontró ese horario activo." });
        return;
    }
    enviarJson(respuesta, 200, { ok: true });
}

async function listarSolicitudes(solicitud, respuesta) {
    const user = obtenerSesionRequerida(solicitud, respuesta);
    if (!user) {
        return;
    }

    let filtro = "";
    const parametros = [];
    if (user.rol === "estudiante") {
        filtro = "WHERE s.estudiante_id = ?";
        parametros.push(user.id);
    } else if (user.rol === "profesor") {
        filtro = "WHERE s.profesor_id = ?";
        parametros.push(user.id);
    }
    const [filas] = await pool.execute(
        `SELECT s.id, s.estudiante_id, s.profesor_id,
                COALESCE(NULLIF(e.nombre, ''), e.usuario) AS estudiante_nombre,
                COALESCE(NULLIF(p.nombre, ''), p.usuario) AS profesor_nombre,
                DATE_FORMAT(s.fecha_inicio, '%Y-%m-%d') AS fecha,
                DATE_FORMAT(s.fecha_inicio, '%H:%i') AS hora_inicio,
                DATE_FORMAT(s.fecha_fin, '%H:%i') AS hora_fin,
                s.asignatura, s.mensaje, s.estado
         FROM solicitudes_asesoria s
         JOIN usuarios e ON e.id = s.estudiante_id
         JOIN usuarios p ON p.id = s.profesor_id
         ${filtro}
         ORDER BY s.fecha_inicio DESC`,
        parametros
    );
    enviarJson(respuesta, 200, { solicitudes: filas });
}

async function crearSolicitud(solicitud, respuesta) {
    const user = obtenerSesionRequerida(solicitud, respuesta, ["estudiante"]);
    if (!user) {
        return;
    }

    const datos = await leerJson(solicitud);
    const disponibilidadId = Number(datos && datos.disponibilidad_id);
    const fecha = datos && datos.fecha;
    const inicio = datos && datos.hora_inicio;
    const duracion = Number(datos && datos.duracion_minutos);
    const asignatura = typeof (datos && datos.asignatura) === "string" ? datos.asignatura.trim() : "";
    const mensaje = typeof (datos && datos.mensaje) === "string" ? datos.mensaje.trim() : "";
    if (!Number.isSafeInteger(disponibilidadId) || disponibilidadId < 1
        || !formatoFechaValido(fecha) || !formatoHoraValido(inicio)
        || ![30, 60].includes(duracion)
        || !asignatura || asignatura.length > 120 || mensaje.length > 1000) {
        enviarJson(respuesta, 400, { error: "Completa correctamente los datos de la asesoría." });
        return;
    }

    const fechaLocal = new Date(`${fecha}T00:00:00`);
    const diaSemana = ((fechaLocal.getDay() + 6) % 7) + 1;
    const finMinutos = minutosHora(inicio) + duracion;
    if (finMinutos > 1439) {
        enviarJson(respuesta, 400, { error: "La asesoría debe finalizar antes de medianoche." });
        return;
    }
    const fin = `${String(Math.floor(finMinutos / 60)).padStart(2, "0")}:${String(finMinutos % 60).padStart(2, "0")}`;

    const [horarios] = await pool.execute(
        `SELECT d.profesor_id,
                TIME_FORMAT(d.hora_inicio, '%H:%i') AS hora_inicio,
                TIME_FORMAT(d.hora_fin, '%H:%i') AS hora_fin
         FROM disponibilidades d
         JOIN usuarios p ON p.id = d.profesor_id
         WHERE d.id = ? AND d.dia_semana = ? AND d.activa = 1 AND p.activo = 1`,
        [disponibilidadId, diaSemana]
    );
    const horario = horarios[0];
    if (!horario || minutosHora(inicio) < minutosHora(horario.hora_inicio)
        || finMinutos > minutosHora(horario.hora_fin)) {
        enviarJson(respuesta, 409, { error: "La fecha u hora no corresponde con la disponibilidad del profesor." });
        return;
    }

    const fechaInicio = `${fecha} ${inicio}:00`;
    const fechaFin = `${fecha} ${fin}:00`;
    const [conflictos] = await pool.execute(
        `SELECT id FROM solicitudes_asesoria
         WHERE profesor_id = ? AND estado IN ('pendiente', 'aceptada')
           AND fecha_inicio < ? AND fecha_fin > ? AND fecha_inicio > NOW()
         LIMIT 1`,
        [horario.profesor_id, fechaFin, fechaInicio]
    );
    if (conflictos.length) {
        enviarJson(respuesta, 409, { error: "Ese horario acaba de ser reservado. Elige otro espacio." });
        return;
    }
    if (new Date(`${fecha}T${inicio}:00`).getTime() <= Date.now()) {
        enviarJson(respuesta, 400, { error: "La fecha y hora deben ser futuras." });
        return;
    }

    const [resultado] = await pool.execute(
        `INSERT INTO solicitudes_asesoria
            (estudiante_id, profesor_id, fecha_inicio, fecha_fin, asignatura, mensaje)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [user.id, horario.profesor_id, fechaInicio, fechaFin, asignatura, mensaje || null]
    );
    enviarJson(respuesta, 201, { id: resultado.insertId });
}

async function actualizarEstadoSolicitud(solicitud, respuesta, id) {
    const user = obtenerSesionRequerida(solicitud, respuesta);
    if (!user) {
        return;
    }
    const datos = await leerJson(solicitud);
    const estado = datos && datos.estado;
    const estadosValidos = ["pendiente", "aceptada", "rechazada", "cancelada", "completada"];
    if (!estadosValidos.includes(estado)) {
        enviarJson(respuesta, 400, { error: "El estado seleccionado no es válido." });
        return;
    }

    let filtro = "";
    if (user.rol === "estudiante" && estado === "cancelada") {
        filtro = "AND estudiante_id = ? AND estado IN ('pendiente', 'aceptada')";
    } else if (user.rol === "profesor" && ["aceptada", "rechazada"].includes(estado)) {
        filtro = "AND profesor_id = ? AND estado = 'pendiente'";
    } else if (user.rol === "administrador") {
        filtro = "";
    } else {
        enviarJson(respuesta, 403, { error: "No tienes permiso para cambiar esta solicitud." });
        return;
    }

    const parametros = [estado, id];
    if (filtro.includes("?")) {
        parametros.push(user.id);
    }
    const [resultado] = await pool.execute(
        `UPDATE solicitudes_asesoria SET estado = ? WHERE id = ? ${filtro}`,
        parametros
    );
    if (!resultado.affectedRows) {
        enviarJson(respuesta, 409, { error: "La solicitud ya cambió o no tienes permiso para modificarla." });
        return;
    }
    enviarJson(respuesta, 200, { ok: true });
}

async function listarUsuarios(solicitud, respuesta) {
    if (!obtenerSesionRequerida(solicitud, respuesta, ["administrador"])) {
        return;
    }
    const [usuarios] = await pool.execute(
        `SELECT id, nombre, correo, usuario, rol, activo,
                DATE_FORMAT(creado_en, '%Y-%m-%d') AS creado_en
         FROM usuarios
         ORDER BY rol, nombre, usuario`
    );
    enviarJson(respuesta, 200, { usuarios });
}

async function actualizarUsuario(solicitud, respuesta, id) {
    const user = obtenerSesionRequerida(solicitud, respuesta, ["administrador"]);
    if (!user) {
        return;
    }
    if (id === user.id) {
        enviarJson(respuesta, 400, { error: "No puedes desactivar tu propia cuenta." });
        return;
    }
    const datos = await leerJson(solicitud);
    if (typeof (datos && datos.activo) !== "boolean") {
        enviarJson(respuesta, 400, { error: "Indica si la cuenta debe estar activa." });
        return;
    }
    const [objetivos] = await pool.execute(
        "SELECT rol, activo FROM usuarios WHERE id = ?",
        [id]
    );
    if (!objetivos.length) {
        enviarJson(respuesta, 404, { error: "No se encontró ese usuario." });
        return;
    }
    if (Boolean(objetivos[0].activo) === datos.activo) {
        enviarJson(respuesta, 200, { ok: true });
        return;
    }
    if (!datos.activo) {
        const [admins] = await pool.execute(
            "SELECT COUNT(*) AS cantidad FROM usuarios WHERE rol = 'administrador' AND activo = 1 AND id <> ?",
            [id]
        );
        if (objetivos[0] && objetivos[0].rol === "administrador" && Number(admins[0].cantidad) === 0) {
            enviarJson(respuesta, 409, { error: "No se puede desactivar al último administrador activo." });
            return;
        }
    }
    const [resultado] = await pool.execute(
        "UPDATE usuarios SET activo = ? WHERE id = ?",
        [datos.activo, id]
    );
    if (!resultado.affectedRows) {
        enviarJson(respuesta, 404, { error: "No se encontró ese usuario." });
        return;
    }
    if (!datos.activo) {
        for (const [sesionId, sesion] of sesiones) {
            if (sesion.usuario.id === id) {
                sesiones.delete(sesionId);
            }
        }
    }
    enviarJson(respuesta, 200, { ok: true });
}

function enviarArchivoEstatico(solicitud, respuesta, rutaUrl) {
    let rutaDecodificada;
    try {
        rutaDecodificada = decodeURIComponent(rutaUrl);
    } catch {
        enviarJson(respuesta, 400, { error: "La ruta solicitada no es válida." });
        return;
    }

    if (rutaDecodificada === "/") {
        rutaDecodificada = "/index.html";
    }
    const permitido = rutasEstaticas.has(rutaDecodificada)
        || carpetasEstaticas.some((carpeta) => rutaDecodificada.startsWith(carpeta));
    if (!permitido || rutaDecodificada === "/Informacion/usuarios.js") {
        enviarJson(respuesta, 404, { error: "No se encontró el recurso solicitado." });
        return;
    }

    const rutaArchivo = path.resolve(ROOT, `.${rutaDecodificada}`);
    if (!rutaArchivo.startsWith(`${ROOT}${path.sep}`)) {
        enviarJson(respuesta, 404, { error: "No se encontró el recurso solicitado." });
        return;
    }

    fs.readFile(rutaArchivo, (error, contenido) => {
        if (error) {
            enviarJson(respuesta, error.code === "ENOENT" ? 404 : 500, {
                error: error.code === "ENOENT" ? "No se encontró el recurso solicitado." : "No se pudo leer el recurso."
            });
            return;
        }

        respuesta.writeHead(200, {
            "Content-Type": tiposContenido[path.extname(rutaArchivo).toLowerCase()] || "application/octet-stream",
            "X-Content-Type-Options": "nosniff"
        });
        respuesta.end(contenido);
    });
}

async function atenderSolicitud(solicitud, respuesta) {
    const url = new URL(solicitud.url, `http://${solicitud.headers.host || "localhost"}`);
    const ruta = url.pathname;

    if (ruta.startsWith("/api/")) {
        if (solicitud.method === "POST" && !mismaOrigen(solicitud)) {
            enviarJson(respuesta, 403, { error: "Origen de solicitud no permitido." });
            return;
        }

        if (["POST", "PATCH"].includes(solicitud.method) && ruta !== "/api/logout"
            && !solicitud.headers["content-type"]?.startsWith("application/json")) {
            enviarJson(respuesta, 415, { error: "La solicitud debe enviarse como JSON." });
            return;
        }

        if (solicitud.method === "POST" && ruta === "/api/login") {
            await iniciarSesion(solicitud, respuesta);
            return;
        }
        if (solicitud.method === "POST" && ruta === "/api/register") {
            await registrarUsuario(solicitud, respuesta);
            return;
        }
        if (solicitud.method === "GET" && ruta === "/api/session") {
            const user = obtenerSesion(solicitud);
            enviarJson(respuesta, user ? 200 : 401, user ? { user } : { error: "La sesión no está activa." });
            return;
        }
        if (solicitud.method === "GET" && ruta === "/api/availability") {
            await consultarDisponibilidades(solicitud, respuesta, url);
            return;
        }
        if (solicitud.method === "POST" && ruta === "/api/availability") {
            await crearDisponibilidad(solicitud, respuesta);
            return;
        }
        const disponibilidad = ruta.match(/^\/api\/availability\/(\d+)$/);
        if (solicitud.method === "DELETE" && disponibilidad) {
            await desactivarDisponibilidad(solicitud, respuesta, Number(disponibilidad[1]));
            return;
        }
        if (solicitud.method === "GET" && ruta === "/api/requests") {
            await listarSolicitudes(solicitud, respuesta);
            return;
        }
        if (solicitud.method === "POST" && ruta === "/api/requests") {
            await crearSolicitud(solicitud, respuesta);
            return;
        }
        const solicitudId = ruta.match(/^\/api\/requests\/(\d+)$/);
        if (solicitud.method === "PATCH" && solicitudId) {
            await actualizarEstadoSolicitud(solicitud, respuesta, Number(solicitudId[1]));
            return;
        }
        if (solicitud.method === "GET" && ruta === "/api/users") {
            await listarUsuarios(solicitud, respuesta);
            return;
        }
        const usuarioId = ruta.match(/^\/api\/users\/(\d+)$/);
        if (solicitud.method === "PATCH" && usuarioId) {
            await actualizarUsuario(solicitud, respuesta, Number(usuarioId[1]));
            return;
        }
        if (solicitud.method === "POST" && ruta === "/api/logout") {
            const id = cookieValor(solicitud, COOKIE_SESION);
            if (id) {
                sesiones.delete(id);
            }
            respuesta.setHeader("Set-Cookie", `${COOKIE_SESION}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
            enviarJson(respuesta, 200, { ok: true });
            return;
        }

        enviarJson(respuesta, 404, { error: "No se encontró la operación solicitada." });
        return;
    }

    if (solicitud.method !== "GET" && solicitud.method !== "HEAD") {
        enviarJson(respuesta, 405, { error: "Método no permitido." });
        return;
    }
    enviarArchivoEstatico(solicitud, respuesta, ruta);
}

const servidor = http.createServer((solicitud, respuesta) => {
    atenderSolicitud(solicitud, respuesta).catch((error) => {
        console.error("Error procesando solicitud:", error);
        if (!respuesta.headersSent) {
            const estado = error.statusCode || 500;
            const mensaje = estado < 500
                ? error.message
                : "Ocurrió un error interno. Revisa la conexión con la base de datos.";
            enviarJson(respuesta, estado, { error: mensaje });
        } else {
            respuesta.destroy();
        }
    });
});

async function iniciarServidor() {
    try {
        await pool.query("SELECT 1");
    } catch (error) {
        console.error("No se pudo conectar con MySQL. Verifica el servicio y la configuración .env:", error.message);
        await pool.end();
        process.exitCode = 1;
        return;
    }

    servidor.listen(PORT, "127.0.0.1", () => {
        console.log(`ProfeDisponible está disponible en http://localhost:${PORT}`);
    });
}

iniciarServidor();
