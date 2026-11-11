
const MAX_INTENTOS = 3;
const TIEMPO_ESPERA = 30; 
const CLAVE_INTENTOS = "profedisponible_intentos";

//html

const mensajeBienvenida = document.getElementById("mensaje-bienvenida");
const formularioLogin = document.getElementById("formulario-login");
const mensajeError = document.getElementById("mensaje-error");

if (!mensajeBienvenida || !formularioLogin || !mensajeError) {
    console.error("No se encontraron los elementos del formulario de inicio de sesión.");
}
// rol

const parametrosURL = new URLSearchParams(window.location.search);
const rolSeleccionado = parametrosURL.get("rol");


// Bienvenida
const mensajesRol = {
    estudiante: "Has seleccionado el acceso de estudiante.",
    profesor: "Has seleccionado el acceso de profesor.",
    administrador: "Has seleccionado el acceso de administrador."
};

mensajeBienvenida.textContent =
    mensajesRol[rolSeleccionado] || "Selecciona un tipo de usuario desde la página principal.";


// intentos fallidos

function obtenerIntentosFallidos() {
    try {
        return JSON.parse(sessionStorage.getItem(CLAVE_INTENTOS)) || { fallos: 0, hasta: 0 };
    } catch (error) {
        return { fallos: 0, hasta: 0 };
    }
}

function registrarFallo() {
    const estado = obtenerIntentosFallidos();
    estado.fallos+= 1;
    if (estado.fallos >= MAX_INTENTOS) {
        estado.hasta = Date.now() + TIEMPO_ESPERA * 1000;
        estado.fallos = 0;


    }

    sessionStorage.setItem(CLAVE_INTENTOS, JSON.stringify(estado));
}

function segundosDeBloqueo() {
    const estado = obtenerIntentosFallidos();
    const restante = estado.hasta - Date.now();
    return restante > 0 ? Math.ceil(restante / 1000) : 0;
}

// iicio de sesion 

formularioLogin.addEventListener("submit", async function (event) {
    event.preventDefault();
    mensajeError.textContent = "";

    const espera = segundosDeBloqueo();
    if (espera > 0) {
        mensajeError.textContent = `Has alcanzado el límite de intentos. Por favor, espera ${espera} segundos antes de intentar nuevamente.`;
        return;
    }   

    if (!window.crypto || !window.crypto.subtle) {
        mensajeError.textContent = "Tu navegador no permite la verificación segura. Abre la página con un navegador actualizado";
        return;

    }

    const usuarioEscrito = document.getElementById("usuario").value.trim().toLowerCase();   
    const contrasenaEscrita = document.getElementById("contrasena").value;

    const registro = BASE_DATOS.usuarios.find(function (u) {
        return u.usuario === usuarioEscrito;

    });

    const sal = registro ? registro.sal : "00000000000000000000000000000000";
    const iteraciones = registro ? registro.iteraciones : 100000;
try {
    const hashCalculado = await calcularHash( contrasenaEscrita,sal,iteraciones);

    const credencialesOk = Boolean(registro && compararSeguro(hashCalculado, registro.hash));

    const rolOk = Boolean(registro && (!rolSeleccionado || registro.rol === rolSeleccionado));

    if (!credencialesOk || !rolOk) {
        registrarFallo();
        mensajeError.textContent = "Usuario o contraseña incorrectos.";
        document.getElementById("contrasena").value = "";
        return;
    }

    sessionStorage.removeItem(CLAVE_INTENTOS);
    guardarSesion(registro.usuario, registro.rol);
    window.location.href = PANTALLA_POR_ROL[registro.rol];

} catch (error) {
    mensajeError.textContent ="Ocurrió un problema al verificar tus datos.";
}
});