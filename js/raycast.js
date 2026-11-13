// ==========================================
// MODEL LAB - RAYCASTING
// Intersección rayo-triángulo (Möller–Trumbore)
// con polígonos de 3 o 4 lados
// ==========================================

const Raycast = {

    rayFromScreen(canvas, camera, clientX, clientY, fovRadians = 55 * Math.PI / 180) {

        const rect = canvas.getBoundingClientRect();

        const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ny = 1 - ((clientY - rect.top) / rect.height) * 2;

        const aspect = rect.width / rect.height;

        const forward = Vector3.normalize(
            Vector3.subtract(camera.target, camera.position)
        );

        const worldUp = [0, 1, 0];

        let right = Vector3.cross(forward, worldUp);
        if (Math.hypot(right[0], right[1], right[2]) < 1e-6) right = [1, 0, 0];
        else right = Vector3.normalize(right);

        const up = Vector3.normalize(Vector3.cross(right, forward));

        const tanHalf = Math.tan(fovRadians / 2);

        const direction = Vector3.normalize(
            Vector3.add(
                Vector3.add(
                    Vector3.multiply(right, nx * tanHalf * aspect),
                    Vector3.multiply(up, ny * tanHalf)
                ),
                forward
            )
        );

        return { origin: [...camera.position], direction };
    },


    rayTriangle(origin, direction, a, b, c) {
        const EPSILON = 1e-7;

        const edge1 = Vector3.subtract(b, a);
        const edge2 = Vector3.subtract(c, a);

        const h = Vector3.cross(direction, edge2);
        const det = Vector3.dot(edge1, h);

        if (Math.abs(det) < EPSILON) return null;

        const invDet = 1 / det;

        const s = Vector3.subtract(origin, a);
        const u = Vector3.dot(s, h) * invDet;
        if (u < 0 || u > 1) return null;

        const q = Vector3.cross(s, edge1);
        const v = Vector3.dot(direction, q) * invDet;
        if (v < 0 || u + v > 1) return null;

        const t = Vector3.dot(edge2, q) * invDet;
        if (t < EPSILON) return null;

        return t;
    },


    localToWorld(object, point) {
        const m = Matrix4.compose(
            object.position,
            object.rotation,
            object.scale,
            object.pivot
        );
        const x = point[0], y = point[1], z = point[2];
        return [
            m[0] * x + m[4] * y + m[8]  * z + m[12],
            m[1] * x + m[5] * y + m[9]  * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14]
        ];
    },


    // Lanza el rayo contra todos los objetos. Devuelve el impacto más cercano:
    // { object, faceIndex, distance, point, triangleLocalTris? }
    pickObjects(objects, ray) {

        let best = null;

        for (const object of objects) {
            const mesh = object.mesh;

            for (let fi = 0; fi < mesh.faces.length; fi++) {
                const face = mesh.faces[fi];
                if (face.length < 3) continue;

                // Triangulamos en abanico desde face[0]
                for (let k = 1; k < face.length - 1; k++) {
                    const ia = face[0];
                    const ib = face[k];
                    const ic = face[k + 1];

                    const a = this.localToWorld(object, mesh.vertices[ia]);
                    const b = this.localToWorld(object, mesh.vertices[ib]);
                    const c = this.localToWorld(object, mesh.vertices[ic]);

                    const t = this.rayTriangle(ray.origin, ray.direction, a, b, c);

                    if (t !== null && (best === null || t < best.distance)) {
                        best = {
                            object,
                            faceIndex: fi,
                            distance: t,
                            point: Vector3.add(
                                ray.origin,
                                Vector3.multiply(ray.direction, t)
                            )
                        };
                    }
                }
            }
        }

        return best;
    }
};