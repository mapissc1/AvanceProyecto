const CLAVE_SESION = "profedisponible_sesion";

const PANTALLA_POR_ROL = {
    estudiante: "estudiante.html",
    profesor: "profesor.html",
    administrador: "administrador.html"
};

function guardarSesion(usuario, rol) {
    sessionStorage.setItem(CLAVE_SESION, JSON.stringify({ usuario: usuario, rol: rol }));
}

function obtenerSesion() {
    try {
        return JSON.parse(sessionStorage.getItem(CLAVE_SESION));
    } catch (error) {
        return null;
    }
}

// crerrar sesion
function cerrarSesion() {
    sessionStorage.removeItem(CLAVE_SESION);
    window.location.href = "index.html";
}

(function protegerPantalla() {
    const rolRequerido = document.documentElement.dataset.rolRequerido;

    if (!rolRequerido) {
        return;

    }

    const sesion = obtenerSesion();

    if (!sesion || sesion.rol !== rolRequerido) {
        window.location.href = "login.html?rol=" + encodeURIComponent(rolRequerido);

    }
})();
document.addEventListener("DOMContentLoaded", function () {
    const botonSalir = document.getElementById("cerrar-sesion");
    if (botonSalir) {
        botonSalir.addEventListener("click", function (event) {
            event.preventDefault();
            cerrarSesion();
        });
    }
});
