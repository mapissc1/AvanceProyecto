const formularioRegistro = document.getElementById("formulario-registro");
const mensajeRegistro = document.getElementById("mensaje-registro");

const PANTALLA_POR_ROL = {
    estudiante: "estudiante.html",
    profesor: "profesor.html"
};

formularioRegistro.addEventListener("submit", async function (event) {
    event.preventDefault();
    mensajeRegistro.textContent = "";

    const contrasena = document.getElementById("contrasena").value;
    const confirmarContrasena = document.getElementById("confirmar-contrasena").value;

    if (contrasena !== confirmarContrasena) {
        mensajeRegistro.textContent = "Las contraseñas no coinciden.";
        return;
    }

    try {
        const respuesta = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                nombre: document.getElementById("nombre").value.trim(),
                correo: document.getElementById("correo").value.trim().toLowerCase(),
                usuario: document.getElementById("usuario").value.trim().toLowerCase(),
                rol: document.getElementById("rol").value,
                contrasena: contrasena
            })
        });
        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            mensajeRegistro.textContent = resultado.error || "No fue posible crear la cuenta.";
            return;
        }

        window.location.href = PANTALLA_POR_ROL[resultado.user.rol];
    } catch (error) {
        console.error("No se pudo conectar con el servidor.", error);
        mensajeRegistro.textContent = "No se pudo conectar con el servidor. Verifica que esté iniciado.";
    }
});
