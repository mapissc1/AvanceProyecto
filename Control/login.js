const formularioLogin = document.getElementById("formulario-login");
const mensajeBienvenida = document.getElementById("mensaje-bienvenida");
const mensajeError = document.getElementById("mensaje-error");

const parametrosURL = new URLSearchParams(window.location.search);
const rolSeleccionado = parametrosURL.get("rol");

const PANTALLA_POR_ROL = {
    estudiante: "estudiante.html",
    profesor: "profesor.html",
    administrador: "administrador.html"
};

const mensajesRol = {
    estudiante: "Has seleccionado el acceso de estudiante.",
    profesor: "Has seleccionado el acceso de profesor.",
    administrador: "Has seleccionado el acceso de administrador."
};

mensajeBienvenida.textContent =
    mensajesRol[rolSeleccionado] || "Selecciona un tipo de usuario desde la página principal.";

formularioLogin.addEventListener("submit", async function (event) {
    event.preventDefault();
    mensajeError.textContent = "";

    const usuario = document.getElementById("usuario").value.trim().toLowerCase();
    const contrasena = document.getElementById("contrasena").value;

    try {
        const respuesta = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                usuario: usuario,
                contrasena: contrasena,
                rol: rolSeleccionado
            })
        });
        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            mensajeError.textContent = resultado.error || "No fue posible iniciar sesión.";
            document.getElementById("contrasena").value = "";
            return;
        }

        window.location.href = PANTALLA_POR_ROL[resultado.user.rol];
    } catch (error) {
        console.error("No se pudo conectar con el servidor.", error);
        mensajeError.textContent = "No se pudo conectar con el servidor. Verifica que esté iniciado.";
    }
});
