const rolPanel = document.documentElement.dataset.rolRequerido;
const mensajePanel = document.getElementById("mensaje-panel");
const nombresDias = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const nombresEstado = {
    pendiente: "Pendiente",
    aceptada: "Aceptada",
    rechazada: "Rechazada",
    cancelada: "Cancelada",
    completada: "Completada"
};
let disponibilidadesActuales = [];

function elemento(etiqueta, texto, clase) {
    const nodo = document.createElement(etiqueta);
    if (texto !== undefined && texto !== null) {
        nodo.textContent = texto;
    }
    if (clase) {
        nodo.className = clase;
    }
    return nodo;
}

function celda(fila, texto) {
    const td = elemento("td", texto || "—");
    fila.appendChild(td);
    return td;
}

function mostrarMensaje(texto, tipo) {
    mensajePanel.textContent = texto || "";
    mensajePanel.classList.toggle("error", tipo === "error");
    mensajePanel.classList.toggle("exito", tipo === "exito");
}

async function api(url, opciones) {
    const respuesta = await fetch(url, opciones || {});
    let resultado;
    try {
        resultado = await respuesta.json();
    } catch (error) {
        throw new Error("El servidor devolvió una respuesta inválida.");
    }
    if (!respuesta.ok) {
        throw new Error(resultado.error || "No se pudo completar la operación.");
    }
    return resultado;
}

function crearBoton(texto, clase, alHacerClick) {
    const boton = elemento("button", texto, `boton-accion ${clase || ""}`.trim());
    boton.type = "button";
    boton.addEventListener("click", alHacerClick);
    return boton;
}

function agregarAccionSolicitud(celdaAccion, solicitud, estado, etiqueta) {
    celdaAccion.appendChild(crearBoton(etiqueta, estado, async function () {
        try {
            await api(`/api/requests/${solicitud.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ estado: estado })
            });
            mostrarMensaje("Se actualizó el estado de la asesoría.", "exito");
            await cargarSolicitudes();
        } catch (error) {
            mostrarMensaje(error.message, "error");
        }
    }));
}

async function cargarDisponibilidades() {
    const resultado = await api("/api/availability");
    const disponibilidades = resultado.disponibilidades;
    disponibilidadesActuales = disponibilidades;
    const contenedor = document.getElementById("lista-disponibilidades");
    if (contenedor) {
        contenedor.replaceChildren();
        if (!disponibilidades.length) {
            contenedor.appendChild(elemento("p", "Todavía no hay horarios publicados.", "estado-vacio"));
        }
        disponibilidades.forEach(function (horario) {
            const tarjeta = elemento("article", undefined, "registro-horario");
            const titulo = rolPanel === "profesor"
                ? nombresDias[horario.dia_semana]
                : horario.profesor_nombre;
            tarjeta.appendChild(elemento("h3", titulo));
            const descripcion = rolPanel === "profesor"
                ? `${horario.hora_inicio} a ${horario.hora_fin}`
                : `${nombresDias[horario.dia_semana]} · ${horario.hora_inicio} a ${horario.hora_fin}`;
            tarjeta.appendChild(elemento("p", descripcion));

            if (rolPanel === "estudiante") {
                tarjeta.appendChild(crearBoton("Elegir este horario", "secundario", function () {
                    document.getElementById("disponibilidad").value = String(horario.id);
                    document.getElementById("solicitar").scrollIntoView({ behavior: "smooth" });
                }));
            } else if (rolPanel === "profesor") {
                tarjeta.appendChild(crearBoton("Desactivar horario", "peligro", async function () {
                    try {
                        await api(`/api/availability/${horario.id}`, { method: "DELETE" });
                        mostrarMensaje("Horario desactivado.", "exito");
                        await cargarDisponibilidades();
                    } catch (error) {
                        mostrarMensaje(error.message, "error");
                    }
                }));
            }
            contenedor.appendChild(tarjeta);
        });
    }

    const selector = document.getElementById("disponibilidad");
    if (selector) {
        const elegido = selector.value;
        selector.replaceChildren(elemento("option", "Selecciona un horario disponible"));
        selector.options[0].value = "";
        disponibilidades.forEach(function (horario) {
            const etiqueta = `${horario.profesor_nombre} · ${nombresDias[horario.dia_semana]} ${horario.hora_inicio}-${horario.hora_fin}`;
            const opcion = elemento("option", etiqueta);
            opcion.value = String(horario.id);
            selector.appendChild(opcion);
        });
        if (disponibilidades.some((horario) => String(horario.id) === elegido)) {
            selector.value = elegido;
        }
        actualizarRangoSolicitud();
    }
}

function agregarFilaSolicitud(tbody, solicitud) {
    const fila = document.createElement("tr");
    celda(fila, `${solicitud.fecha} · ${solicitud.hora_inicio}-${solicitud.hora_fin}`);

    if (rolPanel === "estudiante") {
        celda(fila, solicitud.profesor_nombre);
    } else if (rolPanel === "profesor") {
        celda(fila, solicitud.estudiante_nombre);
    } else {
        celda(fila, solicitud.estudiante_nombre);
        celda(fila, solicitud.profesor_nombre);
    }

    celda(fila, solicitud.asignatura);
    if (rolPanel === "profesor") {
        celda(fila, solicitud.mensaje);
    }
    celda(fila, nombresEstado[solicitud.estado] || solicitud.estado);
    const acciones = document.createElement("td");

    if (rolPanel === "estudiante" && ["pendiente", "aceptada"].includes(solicitud.estado)) {
        agregarAccionSolicitud(acciones, solicitud, "cancelada", "Cancelar");
    } else if (rolPanel === "profesor" && solicitud.estado === "pendiente") {
        agregarAccionSolicitud(acciones, solicitud, "aceptada", "Aceptar");
        agregarAccionSolicitud(acciones, solicitud, "rechazada", "Rechazar");
    } else if (rolPanel === "administrador") {
        const selector = document.createElement("select");
        selector.setAttribute("aria-label", `Cambiar estado de la asesoría ${solicitud.id}`);
        Object.keys(nombresEstado).forEach(function (estado) {
            const opcion = elemento("option", nombresEstado[estado]);
            opcion.value = estado;
            selector.appendChild(opcion);
        });
        selector.value = solicitud.estado;
        selector.addEventListener("change", async function () {
            try {
                await api(`/api/requests/${solicitud.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ estado: selector.value })
                });
                mostrarMensaje("Se actualizó el estado de la asesoría.", "exito");
                await cargarSolicitudes();
            } catch (error) {
                mostrarMensaje(error.message, "error");
                await cargarSolicitudes();
            }
        });
        acciones.appendChild(selector);
    }
    fila.appendChild(acciones);
    tbody.appendChild(fila);
}

async function cargarSolicitudes() {
    const tbody = document.getElementById("tabla-solicitudes");
    if (!tbody) {
        return;
    }
    const resultado = await api("/api/requests");
    tbody.replaceChildren();
    if (!resultado.solicitudes.length) {
        const fila = document.createElement("tr");
        const vacio = elemento("td", "Aún no hay asesorías para mostrar.");
        vacio.colSpan = rolPanel === "administrador" ? 6 : (rolPanel === "profesor" ? 6 : 5);
        fila.appendChild(vacio);
        tbody.appendChild(fila);
        return;
    }
    resultado.solicitudes.forEach((solicitud) => agregarFilaSolicitud(tbody, solicitud));
}

async function cargarUsuarios() {
    const tbody = document.getElementById("tabla-usuarios");
    if (!tbody) {
        return;
    }
    const resultado = await api("/api/users");
    tbody.replaceChildren();
    resultado.usuarios.forEach(function (usuario) {
        const fila = document.createElement("tr");
        celda(fila, usuario.nombre);
        celda(fila, usuario.usuario);
        celda(fila, usuario.correo);
        celda(fila, usuario.rol);
        celda(fila, usuario.activo ? "Activo" : "Desactivado");
        const accion = document.createElement("td");
        const boton = crearBoton(usuario.activo ? "Desactivar" : "Activar", usuario.activo ? "peligro" : "secundario", async function () {
            const cambio = !Boolean(usuario.activo);
            if (!window.confirm(`${cambio ? "¿Activar" : "¿Desactivar"} la cuenta ${usuario.usuario}?`)) {
                return;
            }
            try {
                await api(`/api/users/${usuario.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ activo: cambio })
                });
                mostrarMensaje("Se actualizó la cuenta de usuario.", "exito");
                await cargarUsuarios();
            } catch (error) {
                mostrarMensaje(error.message, "error");
            }
        });
        accion.appendChild(boton);
        fila.appendChild(accion);
        tbody.appendChild(fila);
    });
}

function prepararFormularioDisponibilidad() {
    const formulario = document.getElementById("formulario-disponibilidad");
    if (!formulario) {
        return;
    }
    formulario.addEventListener("submit", async function (event) {
        console.log("SE HIZO CLICK EN PUBLICAR");
        event.preventDefault();
        const inicio = document.getElementById("hora-inicio").value;
        const fin = document.getElementById("hora-fin").value;
        if (inicio >= fin) {
            mostrarMensaje("La hora de fin debe ser posterior a la hora de inicio.", "error");
            return;
        }
        try {
            await api("/api/availability", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    dia_semana: Number(document.getElementById("dia-semana").value),
                    hora_inicio: inicio,
                    hora_fin: fin
                })
            });
            formulario.reset();
            mostrarMensaje("Tu disponibilidad semanal fue publicada.", "exito");
            await cargarDisponibilidades();
        } catch (error) {
            mostrarMensaje(error.message, "error");
        }
    });
}

function prepararFormularioSolicitud() {
    console.log("ENTRO A PREPARAR EL FORMULARIO DE SOLICITUD");
    const formulario = document.getElementById("formulario-solicitud");
    if (!formulario) {
        return;
    }
    const fecha = document.getElementById("fecha");
    const ahora = new Date();
    const fechaLocal = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000)
        .toISOString().slice(0, 10);
    fecha.min = fechaLocal;

    document.getElementById("disponibilidad").addEventListener("change", actualizarRangoSolicitud);
    document.getElementById("duracion").addEventListener("change", actualizarRangoSolicitud);
    document.getElementById("hora-inicio").addEventListener("change", function () {
        const horario = disponibilidadesActuales.find(
            (item) => String(item.id) === document.getElementById("disponibilidad").value
        );
        if (horario && document.getElementById("hora-inicio").value < horario.hora_inicio) {
            document.getElementById("hora-inicio").value = horario.hora_inicio;
        }
    });

    formulario.addEventListener("submit", async function (event) {
        console.log("SE HIZO CLICK EN SOLICITAR");
        event.preventDefault();
        try {
            await api("/api/requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    disponibilidad_id: Number(document.getElementById("disponibilidad").value),
                    fecha: fecha.value,
                    hora_inicio: document.getElementById("hora-inicio").value,
                    duracion_minutos: Number(document.getElementById("duracion").value),
                    asignatura: document.getElementById("asignatura").value.trim(),
                    mensaje: document.getElementById("mensaje").value.trim()
                })
            });
            formulario.reset();
            fecha.min = fechaLocal;
            mostrarMensaje("Tu solicitud fue enviada al profesor.", "exito");
            await Promise.all([cargarSolicitudes(), cargarDisponibilidades()]);
        } catch (error) {
            mostrarMensaje(error.message, "error");
        }
    });
}

function actualizarRangoSolicitud() {
    const selector = document.getElementById("disponibilidad");
    const fecha = document.getElementById("fecha");
    const hora = document.getElementById("hora-inicio");
    const duracion = document.getElementById("duracion");
    if (!selector || !fecha || !hora || !duracion) {
        return;
    }

    const horario = disponibilidadesActuales.find((item) => String(item.id) === selector.value);
    if (!horario) {
        hora.removeAttribute("min");
        hora.removeAttribute("max");
        return;
    }

    const minutosFin = Number(horario.hora_fin.slice(0, 2)) * 60
        + Number(horario.hora_fin.slice(3, 5))
        - Number(duracion.value);
    const maximoInicio = `${String(Math.floor(minutosFin / 60)).padStart(2, "0")}:${String(minutosFin % 60).padStart(2, "0")}`;
    hora.min = horario.hora_inicio;
    hora.max = maximoInicio;
    if (hora.value && (hora.value < hora.min || hora.value > hora.max)) {
        hora.value = "";
    }

    if (!fecha.value) {
        const proximaFecha = new Date(`${fecha.min || new Date().toISOString().slice(0, 10)}T00:00:00`);
        const diaActual = ((proximaFecha.getDay() + 6) % 7) + 1;
        const diferencia = (Number(horario.dia_semana) - diaActual + 7) % 7;
        proximaFecha.setDate(proximaFecha.getDate() + diferencia);
        const local = new Date(proximaFecha.getTime() - proximaFecha.getTimezoneOffset() * 60000);
        fecha.value = local.toISOString().slice(0, 10);
    }
}

async function iniciarPanel() {
    prepararFormularioDisponibilidad();
    console.log("ENTRO A PREPARAR EL FORMULARIO DE DISPONIBILIDAD");
    prepararFormularioSolicitud();
    const cargas = [cargarSolicitudes()];
    if (document.getElementById("lista-disponibilidades") || document.getElementById("disponibilidad")) {
        cargas.push(cargarDisponibilidades());
    }
    if (document.getElementById("tabla-usuarios")) {
        cargas.push(cargarUsuarios());
    }
    try {
        await Promise.all(cargas);
    } catch (error) {
        mostrarMensaje(error.message, "error");
    }
}

iniciarPanel();
