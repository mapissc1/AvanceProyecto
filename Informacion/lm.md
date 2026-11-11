# Carpeta informacion

Aquí vive la "base de datos" de ProfeDisponible (por ahora `usuarios.js`).

## Usuarios de prueba

| Usuario       | Rol           | Contraseña        |
|---------------|---------------|-------------------|
| estudiante1   | estudiante    | Estudiante#2026   |
| profesor1     | profesor      | Profesor#2026     |
| admin1        | administrador | Admin#2026        |

Cámbialas antes de usar la plataforma de verdad.

## Cómo agregar un usuario

Las contraseñas no se guardan en texto plano: cada usuario lleva una `sal`
aleatoria y un `hash` PBKDF2-SHA256 (100000 iteraciones). Con Python:

```python
import hashlib, os
clave = "TuContraseña"
sal = os.urandom(16)
print("sal :", sal.hex())
print("hash:", hashlib.pbkdf2_hmac("sha256", clave.encode(), sal, 100000).hex())
```

Copia la `sal` y el `hash` en un nuevo bloque dentro de `usuarios.js`.

## Aviso sobre seguridad

Esta es una página que corre solo en el navegador, así que cualquiera con
acceso a los archivos puede leerlos y saltarse las validaciones. El hash evita
que se vean las contraseñas, pero la protección real requiere un servidor
(backend) con base de datos. Cuando pasen a esa etapa, `usuarios.js` se
reemplaza por esa base de datos.
