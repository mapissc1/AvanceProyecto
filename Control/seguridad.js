function hexABytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

function bytesAHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(function (b) { return b.toString(16).padStart(2, "0"); })
        .join("");
}

async function calcularHash(contrasena, salHex, iteraciones) {
    const codificador = new TextEncoder();

    const llave = await crypto.subtle.importKey(
        "raw",
        codificador.encode(contrasena),
        "PBKDF2",
        false,
        ["deriveBits"]
    );

    const bits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            hash: "SHA-256",
            salt: hexABytes(salHex),
            iterations: iteraciones
        },
        llave,
        256
    );

    return bytesAHex(bits);
}

function compararSeguro(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    let diferencia = 0;
    for (let i = 0; i < a.length; i++) {
        diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diferencia === 0;
}
