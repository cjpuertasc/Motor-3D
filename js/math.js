// ==========================================
// MODEL LAB - MATH ENGINE
// Matemáticas 3D desde cero
// ==========================================

const Vector3 = {

    add(a, b) {
        return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    },

    subtract(a, b) {
        return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    },

    multiply(a, value) {
        return [a[0] * value, a[1] * value, a[2] * value];
    },

    dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    },

    cross(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    },

    normalize(a) {
        const length = Math.hypot(a[0], a[1], a[2]) || 1;
        return [a[0] / length, a[1] / length, a[2] / length];
    },

    lerp(a, b, t) {
        return [
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t
        ];
    }
};


// ==========================================
// MATRICES 4x4
// ==========================================

const Matrix4 = {

    identity() {
        return new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ]);
    },

    translation(t) {
        return new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            t[0], t[1], t[2], 1
        ]);
    },

    multiply(a, b) {
        const out = new Float32Array(16);
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                out[col * 4 + row] =
                    a[row] * b[col * 4] +
                    a[4 + row] * b[col * 4 + 1] +
                    a[8 + row] * b[col * 4 + 2] +
                    a[12 + row] * b[col * 4 + 3];
            }
        }
        return out;
    },

    perspective(fov, aspect, near, far) {
        const f = 1 / Math.tan(fov / 2);
        const nf = 1 / (near - far);
        const out = new Float32Array(16);
        out[0] = f / aspect;
        out[5] = f;
        out[10] = (far + near) * nf;
        out[11] = -1;
        out[14] = 2 * far * near * nf;
        return out;
    },

    lookAt(eye, target, up) {
        const z = Vector3.normalize(Vector3.subtract(eye, target));
        const x = Vector3.normalize(Vector3.cross(up, z));
        const y = Vector3.cross(z, x);

        return new Float32Array([
            x[0], y[0], z[0], 0,
            x[1], y[1], z[1], 0,
            x[2], y[2], z[2], 0,
            -Vector3.dot(x, eye),
            -Vector3.dot(y, eye),
            -Vector3.dot(z, eye),
            1
        ]);
    },

    rotationScale(rotation, scale) {
        const [x, y, z] = rotation.map(v => v * Math.PI / 180);

        const cx = Math.cos(x), sx = Math.sin(x);
        const cy = Math.cos(y), sy = Math.sin(y);
        const cz = Math.cos(z), sz = Math.sin(z);

        const r00 = cz * cy;
        const r01 = cz * sy * sx - sz * cx;
        const r02 = cz * sy * cx + sz * sx;

        const r10 = sz * cy;
        const r11 = sz * sy * sx + cz * cx;
        const r12 = sz * sy * cx - cz * sx;

        const r20 = -sy;
        const r21 = cy * sx;
        const r22 = cy * cx;

        return new Float32Array([
            r00 * scale[0], r10 * scale[0], r20 * scale[0], 0,
            r01 * scale[1], r11 * scale[1], r21 * scale[1], 0,
            r02 * scale[2], r12 * scale[2], r22 * scale[2], 0,
            0, 0, 0, 1
        ]);
    },

    // Compone T(position) * T(pivot) * R * S * T(-pivot)
    // Rotación y escala ocurren alrededor de `pivot` (en local).
    compose(position, rotation, scale, pivot) {
        const p = pivot || [0, 0, 0];

        const RS = this.rotationScale(rotation, scale);

        const px = p[0], py = p[1], pz = p[2];
        const rsPivot = [
            RS[0] * px + RS[4] * py + RS[8]  * pz,
            RS[1] * px + RS[5] * py + RS[9]  * pz,
            RS[2] * px + RS[6] * py + RS[10] * pz
        ];

        const out = new Float32Array(RS);

        out[12] = position[0] + px - rsPivot[0];
        out[13] = position[1] + py - rsPivot[1];
        out[14] = position[2] + pz - rsPivot[2];

        return out;
    }
};