// Rutas de los paneles según el rol
const PANTALLA_POR_ROL = {
    estudiante: "estudiante.html",
    profesor: "profesor.html",
    administrador: "administrador.html"
};

// Cerrar sesión
async function cerrarSesion() {
    try {
        const respuesta = await fetch("/api/logout", {
            method: "POST",
            credentials: "same-origin"
        });

        if (!respuesta.ok) {
            throw new Error("No se pudo cerrar la sesión.");
        }

        window.location.replace("/");

    } catch (error) {
        console.error("Error al cerrar sesión:", error);
        alert("No se pudo cerrar la sesión. Intenta nuevamente.");
    }
}

// Proteger los paneles según el rol
(async function protegerPantalla() {

    const rolRequerido =
        document.documentElement.dataset.rolRequerido;

    if (!rolRequerido) return;

    try {
        const respuesta = await fetch("/api/session", {
            credentials: "same-origin"
        });

        const resultado = await respuesta.json();

        if (
            !respuesta.ok ||
            !resultado.user ||
            resultado.user.rol !== rolRequerido
        ) {
            window.location.replace(
                "/Pantalla/login.html?rol=" +
                encodeURIComponent(rolRequerido)
            );
        }

    } catch (error) {
        console.error("Error verificando sesión:", error);

        window.location.replace(
            "/Pantalla/login.html?rol=" +
            encodeURIComponent(rolRequerido)
        );
    }

})();

// Evento del botón cerrar sesión
document.addEventListener("DOMContentLoaded", function () {

    const botonSalir =
        document.getElementById("cerrar-sesion");

    if (botonSalir) {
        botonSalir.addEventListener("click", function (event) {
            event.preventDefault();
            cerrarSesion();
        });
    }

});