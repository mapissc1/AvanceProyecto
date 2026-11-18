CREATE DATABASE IF NOT EXISTS profedisponible
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE profedisponible;

CREATE TABLE IF NOT EXISTS usuarios (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    nombre VARCHAR(120) NULL,
    correo VARCHAR(254) NULL,
    usuario VARCHAR(50) NOT NULL,
    rol ENUM('estudiante', 'profesor', 'administrador') NOT NULL,
    sal CHAR(32) NOT NULL,
    hash_contrasena CHAR(64) NOT NULL,
    iteraciones_hash INT UNSIGNED NOT NULL DEFAULT 100000,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_usuarios_usuario (usuario),
    UNIQUE KEY uq_usuarios_correo (correo)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS disponibilidades (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    profesor_id BIGINT UNSIGNED NOT NULL,
    dia_semana TINYINT UNSIGNED NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_disponibilidades_profesor_dia (profesor_id, dia_semana, activa),
    CONSTRAINT fk_disponibilidades_profesor
        FOREIGN KEY (profesor_id) REFERENCES usuarios (id)
        ON DELETE CASCADE,
    CONSTRAINT chk_disponibilidades_dia
        CHECK (dia_semana BETWEEN 1 AND 7),
    CONSTRAINT chk_disponibilidades_horas
        CHECK (hora_inicio < hora_fin)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS solicitudes_asesoria (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    estudiante_id BIGINT UNSIGNED NOT NULL,
    profesor_id BIGINT UNSIGNED NOT NULL,
    fecha_inicio DATETIME NOT NULL,
    fecha_fin DATETIME NOT NULL,
    asignatura VARCHAR(120) NULL,
    mensaje TEXT NULL,
    estado ENUM('pendiente', 'aceptada', 'rechazada', 'cancelada', 'completada')
        NOT NULL DEFAULT 'pendiente',
    creada_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizada_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_solicitudes_estudiante_fecha (estudiante_id, fecha_inicio),
    KEY ix_solicitudes_profesor_estado_fecha (profesor_id, estado, fecha_inicio),
    CONSTRAINT fk_solicitudes_estudiante
        FOREIGN KEY (estudiante_id) REFERENCES usuarios (id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_solicitudes_profesor
        FOREIGN KEY (profesor_id) REFERENCES usuarios (id)
        ON DELETE RESTRICT,
    CONSTRAINT chk_solicitudes_fechas
        CHECK (fecha_inicio < fecha_fin)
) ENGINE=InnoDB;

INSERT IGNORE INTO usuarios
    (usuario, rol, sal, hash_contrasena, iteraciones_hash)
VALUES
    ('estudiante1', 'estudiante', 'a6eff9044feeede066c6ce62b2d0c12d',
     '6155c169b94264960f81eb9e6820d952eee48a87e00e61c86bc5cb3171a31c7c', 100000),
    ('profesor1', 'profesor', '962a2826f99f7576d4d66724a240cfc7',
     '689370419a2734e5cc37a14f098a4cea49d5e3d8fb981401918c1e9b64945578', 100000),
    ('admin1', 'administrador', 'e895e862d0092dd4fe13a795504d40a7',
     '1792f423a13abee290a49ebd50fe20e572347c7bc3481166b91f3e3f9111bb0a', 100000);