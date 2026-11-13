// ==========================================
// MODEL LAB - GEOMETRY ENGINE
// ==========================================

function createMesh(vertices, faces, color) {
    return {
        vertices: vertices.map(v => [v[0], v[1], v[2]]),
        faces: faces.map(f => f.slice()),
        color: color,
        version: 0,
        edgeMidpoints: new Map()
    };
}

function computeEdges(mesh) {
    const seen = new Set();
    const edges = [];
    for (const face of mesh.faces) {
        const n = face.length;
        for (let i = 0; i < n; i++) {
            const a = face[i];
            const b = face[(i + 1) % n];
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (!seen.has(key)) {
                seen.add(key);
                edges.push([a, b]);
            }
        }
    }
    return edges;
}

function triangulateFace(face) {
    const tris = [];
    if (face.length < 3) return tris;
    for (let i = 1; i < face.length - 1; i++) {
        tris.push([face[0], face[i], face[i + 1]]);
    }
    return tris;
}

function buildRenderData(mesh) {
    const positions = [];
    const normals = [];
    const indices = [];
    let cursor = 0;

    for (const face of mesh.faces) {
        if (face.length < 3) continue;
        let nx = 0, ny = 0, nz = 0;
        const tris = triangulateFace(face);
        for (const t of tris) {
            const a = mesh.vertices[t[0]];
            const b = mesh.vertices[t[1]];
            const c = mesh.vertices[t[2]];
            const ab = Vector3.subtract(b, a);
            const ac = Vector3.subtract(c, a);
            const n = Vector3.cross(ab, ac);
            nx += n[0]; ny += n[1]; nz += n[2];
        }
        const normal = Vector3.normalize([nx, ny, nz]);
        for (const t of tris) {
            const a = mesh.vertices[t[0]];
            const b = mesh.vertices[t[1]];
            const c = mesh.vertices[t[2]];
            positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
            normals.push(
                normal[0], normal[1], normal[2],
                normal[0], normal[1], normal[2],
                normal[0], normal[1], normal[2]
            );
            indices.push(cursor, cursor + 1, cursor + 2);
            cursor += 3;
        }
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        indices: new Uint16Array(indices)
    };
}

function buildRenderDataSmooth(mesh) {
    const nVert = mesh.vertices.length;
    const accum = new Float32Array(nVert * 3);

    for (const face of mesh.faces) {
        if (face.length < 3) continue;
        let nx = 0, ny = 0, nz = 0;
        const tris = triangulateFace(face);
        for (const t of tris) {
            const a = mesh.vertices[t[0]];
            const b = mesh.vertices[t[1]];
            const c = mesh.vertices[t[2]];
            const ab = Vector3.subtract(b, a);
            const ac = Vector3.subtract(c, a);
            const n = Vector3.cross(ab, ac);
            nx += n[0]; ny += n[1]; nz += n[2];
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        const fnx = nx / len, fny = ny / len, fnz = nz / len;
        for (const vi of face) {
            accum[vi * 3 + 0] += fnx;
            accum[vi * 3 + 1] += fny;
            accum[vi * 3 + 2] += fnz;
        }
    }

    const normalsPerVert = new Float32Array(nVert * 3);
    for (let i = 0; i < nVert; i++) {
        const x = accum[i * 3 + 0];
        const y = accum[i * 3 + 1];
        const z = accum[i * 3 + 2];
        const len = Math.hypot(x, y, z) || 1;
        normalsPerVert[i * 3 + 0] = x / len;
        normalsPerVert[i * 3 + 1] = y / len;
        normalsPerVert[i * 3 + 2] = z / len;
    }

    const positions = [];
    const normals = [];
    const indices = [];
    let cursor = 0;

    for (const face of mesh.faces) {
        if (face.length < 3) continue;
        const tris = triangulateFace(face);
        for (const t of tris) {
            for (const vi of t) {
                const v = mesh.vertices[vi];
                positions.push(v[0], v[1], v[2]);
                normals.push(
                    normalsPerVert[vi * 3 + 0],
                    normalsPerVert[vi * 3 + 1],
                    normalsPerVert[vi * 3 + 2]
                );
            }
            indices.push(cursor, cursor + 1, cursor + 2);
            cursor += 3;
        }
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        indices: new Uint16Array(indices)
    };
}

// =================================================
// CATMULL-CLARK
// =================================================

function catmullClarkOnce(mesh) {

    const V = mesh.vertices;
    const F = mesh.faces;

    if (V.length === 0 || F.length === 0) {
        return {
            vertices: V.map(v => [v[0], v[1], v[2]]),
            faces: F.map(f => f.slice())
        };
    }

    const facePoints = new Array(F.length);
    for (let fi = 0; fi < F.length; fi++) {
        const face = F[fi];
        let x = 0, y = 0, z = 0;
        for (const vi of face) {
            const v = V[vi];
            x += v[0]; y += v[1]; z += v[2];
        }
        const n = face.length;
        facePoints[fi] = [x / n, y / n, z / n];
    }

    const edgeMap = new Map();
    for (let fi = 0; fi < F.length; fi++) {
        const face = F[fi];
        const n = face.length;
        for (let i = 0; i < n; i++) {
            const a = face[i];
            const b = face[(i + 1) % n];
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (!edgeMap.has(key)) {
                edgeMap.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [] });
            }
            edgeMap.get(key).faces.push(fi);
        }
    }

    const edgePoints = new Map();
    for (const [key, edge] of edgeMap) {
        const va = V[edge.a];
        const vb = V[edge.b];

        if (edge.faces.length === 2) {
            const f1 = facePoints[edge.faces[0]];
            const f2 = facePoints[edge.faces[1]];
            edgePoints.set(key, [
                (va[0] + vb[0] + f1[0] + f2[0]) / 4,
                (va[1] + vb[1] + f1[1] + f2[1]) / 4,
                (va[2] + vb[2] + f1[2] + f2[2]) / 4
            ]);
        } else {
            edgePoints.set(key, [
                (va[0] + vb[0]) / 2,
                (va[1] + vb[1]) / 2,
                (va[2] + vb[2]) / 2
            ]);
        }
    }

    const vertexFaces = new Array(V.length).fill(null).map(() => []);
    const vertexEdges = new Array(V.length).fill(null).map(() => []);

    for (let fi = 0; fi < F.length; fi++) {
        for (const vi of F[fi]) {
            vertexFaces[vi].push(fi);
        }
    }
    for (const [key, edge] of edgeMap) {
        vertexEdges[edge.a].push(key);
        vertexEdges[edge.b].push(key);
    }

    const isBoundaryVertex = new Array(V.length).fill(false);
    for (const [key, edge] of edgeMap) {
        if (edge.faces.length === 1) {
            isBoundaryVertex[edge.a] = true;
            isBoundaryVertex[edge.b] = true;
        }
    }

    const newVertexPoints = new Array(V.length);
    for (let vi = 0; vi < V.length; vi++) {
        const P = V[vi];
        const faces = vertexFaces[vi];
        const edgeKeys = vertexEdges[vi];
        const n = faces.length;

        if (n === 0) {
            newVertexPoints[vi] = [P[0], P[1], P[2]];
            continue;
        }

        if (isBoundaryVertex[vi]) {
            const boundaryEdges = edgeKeys.filter(k => edgeMap.get(k).faces.length === 1);
            if (boundaryEdges.length === 2) {
                const R1 = edgePoints.get(boundaryEdges[0]);
                const R2 = edgePoints.get(boundaryEdges[1]);
                newVertexPoints[vi] = [
                    (P[0] + R1[0] + R2[0]) / 3,
                    (P[1] + R1[1] + R2[1]) / 3,
                    (P[2] + R1[2] + R2[2]) / 3
                ];
            } else {
                let x = P[0], y = P[1], z = P[2];
                let count = 1;
                for (const key of boundaryEdges) {
                    const R = edgePoints.get(key);
                    x += R[0]; y += R[1]; z += R[2];
                    count++;
                }
                newVertexPoints[vi] = [x / count, y / count, z / count];
            }
            continue;
        }

        let fx = 0, fy = 0, fz = 0;
        for (const fi of faces) {
            const fp = facePoints[fi];
            fx += fp[0]; fy += fp[1]; fz += fp[2];
        }
        fx /= n; fy /= n; fz /= n;

        let rx = 0, ry = 0, rz = 0;
        const ne = edgeKeys.length;
        for (const key of edgeKeys) {
            const ep = edgePoints.get(key);
            rx += ep[0]; ry += ep[1]; rz += ep[2];
        }
        if (ne > 0) {
            rx /= ne; ry /= ne; rz /= ne;
        }

        newVertexPoints[vi] = [
            (fx + 2 * rx + (n - 3) * P[0]) / n,
            (fy + 2 * ry + (n - 3) * P[1]) / n,
            (fz + 2 * rz + (n - 3) * P[2]) / n
        ];
    }

    const newVertices = [];
    for (let i = 0; i < V.length; i++) newVertices.push(newVertexPoints[i]);
    for (let i = 0; i < F.length; i++) newVertices.push(facePoints[i]);

    const edgeIndexMap = new Map();
    const edgeList = [];
    for (const [key, edge] of edgeMap) {
        edgeIndexMap.set(key, V.length + F.length + edgeList.length);
        edgeList.push(key);
        newVertices.push(edgePoints.get(key));
    }

    const facePointBase = V.length;

    const faceRefNormals = new Array(F.length);
    for (let fi = 0; fi < F.length; fi++) {
        const face = F[fi];
        if (face.length < 3) {
            faceRefNormals[fi] = [0, 1, 0];
            continue;
        }
        const a = V[face[0]];
        const b = V[face[1]];
        const c = V[face[2]];
        const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
        const ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
        const n = [
            ab[1]*ac[2] - ab[2]*ac[1],
            ab[2]*ac[0] - ab[0]*ac[2],
            ab[0]*ac[1] - ab[1]*ac[0]
        ];
        const len = Math.hypot(n[0], n[1], n[2]) || 1;
        faceRefNormals[fi] = [n[0]/len, n[1]/len, n[2]/len];
    }

    const newFaces = [];
    for (let fi = 0; fi < F.length; fi++) {
        const face = F[fi];
        const n = face.length;
        const fpIdx = facePointBase + fi;
        const refNormal = faceRefNormals[fi];

        for (let i = 0; i < n; i++) {
            const vi = face[i];
            const prevVi = face[(i - 1 + n) % n];
            const nextVi = face[(i + 1) % n];

            const eNextKey = vi < nextVi ? `${vi}_${nextVi}` : `${nextVi}_${vi}`;
            const ePrevKey = prevVi < vi ? `${prevVi}_${vi}` : `${vi}_${prevVi}`;

            const eNextIdx = edgeIndexMap.get(eNextKey);
            const ePrevIdx = edgeIndexMap.get(ePrevKey);

            const pa = newVertices[vi];
            const pb = newVertices[eNextIdx];
            const pc = newVertices[fpIdx];
            const ab = [pb[0]-pa[0], pb[1]-pa[1], pb[2]-pa[2]];
            const ac = [pc[0]-pa[0], pc[1]-pa[1], pc[2]-pa[2]];
            const cross = [
                ab[1]*ac[2] - ab[2]*ac[1],
                ab[2]*ac[0] - ab[0]*ac[2],
                ab[0]*ac[1] - ab[1]*ac[0]
            ];
            const dot = cross[0]*refNormal[0] + cross[1]*refNormal[1] + cross[2]*refNormal[2];

            if (dot >= 0) {
                newFaces.push([vi, eNextIdx, fpIdx, ePrevIdx]);
            } else {
                newFaces.push([vi, ePrevIdx, fpIdx, eNextIdx]);
            }
        }
    }

    return {
        vertices: newVertices,
        faces: newFaces
    };
}

function catmullClarkSubdivide(mesh, level) {
    let current = {
        vertices: mesh.vertices.map(v => [v[0], v[1], v[2]]),
        faces: mesh.faces.map(f => f.slice())
    };

    const levels = Math.max(0, Math.min(5, Math.floor(level)));
    const MAX_FACES = 300000; // tope para no congelar el navegador

    for (let i = 0; i < levels; i++) {
        const next = current.faces.reduce((n, f) => n + f.length, 0);
        if (next > MAX_FACES) break;
        current = catmullClarkOnce(current);
    }

    return current;
}

function buildRenderDataSubdivided(mesh, level) {
    const sub = catmullClarkSubdivide(mesh, level);

    const nVert = sub.vertices.length;

    const accum = new Float32Array(nVert * 3);

    for (const face of sub.faces) {
        if (face.length < 3) continue;
        const tris = triangulateFace(face);
        for (const t of tris) {
            const a = sub.vertices[t[0]];
            const b = sub.vertices[t[1]];
            const c = sub.vertices[t[2]];
            const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
            const ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
            const n = [
                ab[1]*ac[2] - ab[2]*ac[1],
                ab[2]*ac[0] - ab[0]*ac[2],
                ab[0]*ac[1] - ab[1]*ac[0]
            ];
            for (const vi of t) {
                accum[vi * 3 + 0] += n[0];
                accum[vi * 3 + 1] += n[1];
                accum[vi * 3 + 2] += n[2];
            }
        }
    }

    const normalsPerVert = new Float32Array(nVert * 3);
    for (let i = 0; i < nVert; i++) {
        const x = accum[i * 3 + 0];
        const y = accum[i * 3 + 1];
        const z = accum[i * 3 + 2];
        const len = Math.hypot(x, y, z) || 1;
        normalsPerVert[i * 3 + 0] = x / len;
        normalsPerVert[i * 3 + 1] = y / len;
        normalsPerVert[i * 3 + 2] = z / len;
    }

    const positions = [];
    const normals = [];
    const indices = [];
    let cursor = 0;

    for (const face of sub.faces) {
        if (face.length < 3) continue;
        const tris = triangulateFace(face);
        for (const t of tris) {
            for (const vi of t) {
                const v = sub.vertices[vi];
                positions.push(v[0], v[1], v[2]);
                normals.push(
                    normalsPerVert[vi * 3 + 0],
                    normalsPerVert[vi * 3 + 1],
                    normalsPerVert[vi * 3 + 2]
                );
            }
            indices.push(cursor, cursor + 1, cursor + 2);
            cursor += 3;
        }
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        indices: new Uint32Array(indices),
        subdividedVertices: sub.vertices.length,
        subdividedFaces: sub.faces.length
    };
}


// ==========================================
// CUBO con divisiones por eje
// ==========================================

function createCube(divX = 1, divY = 1, divZ = 1) {
    divX = Math.max(1, Math.floor(divX));
    divY = Math.max(1, Math.floor(divY));
    divZ = Math.max(1, Math.floor(divZ));

    if (divX === 1 && divY === 1 && divZ === 1) {
        const vertices = [
            [-1, -1, -1], [ 1, -1, -1], [ 1,  1, -1], [-1,  1, -1],
            [-1, -1,  1], [ 1, -1,  1], [ 1,  1,  1], [-1,  1,  1]
        ];
        const faces = [
            [0, 3, 2, 1],
            [4, 5, 6, 7],
            [0, 4, 7, 3],
            [1, 2, 6, 5],
            [3, 7, 6, 2],
            [0, 1, 5, 4]
        ];
        return createMesh(vertices, faces, [0.62, 0.65, 0.75]);
    }

    const nx = divX + 1;
    const ny = divY + 1;
    const nz = divZ + 1;
    const vertices = [];

    for (let k = 0; k < nz; k++) {
        const z = -1 + 2 * k / divZ;
        for (let j = 0; j < ny; j++) {
            const y = -1 + 2 * j / divY;
            for (let i = 0; i < nx; i++) {
                const x = -1 + 2 * i / divX;
                vertices.push([x, y, z]);
            }
        }
    }

    function idx(i, j, k) {
        return k * nx * ny + j * nx + i;
    }

    const faces = [];

    for (let j = 0; j < divY; j++) {
        for (let i = 0; i < divX; i++) {
            const a = idx(i, j, 0);
            const b = idx(i + 1, j, 0);
            const c = idx(i + 1, j + 1, 0);
            const d = idx(i, j + 1, 0);
            faces.push([a, d, c, b]);
        }
    }

    for (let j = 0; j < divY; j++) {
        for (let i = 0; i < divX; i++) {
            const a = idx(i, j, divZ);
            const b = idx(i + 1, j, divZ);
            const c = idx(i + 1, j + 1, divZ);
            const d = idx(i, j + 1, divZ);
            faces.push([a, b, c, d]);
        }
    }

    for (let k = 0; k < divZ; k++) {
        for (let j = 0; j < divY; j++) {
            const a = idx(0, j, k);
            const b = idx(0, j, k + 1);
            const c = idx(0, j + 1, k + 1);
            const d = idx(0, j + 1, k);
            faces.push([a, b, c, d]);
        }
    }

    for (let k = 0; k < divZ; k++) {
        for (let j = 0; j < divY; j++) {
            const a = idx(divX, j, k);
            const b = idx(divX, j + 1, k);
            const c = idx(divX, j + 1, k + 1);
            const d = idx(divX, j, k + 1);
            faces.push([a, b, c, d]);
        }
    }

    for (let k = 0; k < divZ; k++) {
        for (let i = 0; i < divX; i++) {
            const a = idx(i, divY, k);
            const b = idx(i + 1, divY, k);
            const c = idx(i + 1, divY, k + 1);
            const d = idx(i, divY, k + 1);
            faces.push([a, d, c, b]);
        }
    }

    for (let k = 0; k < divZ; k++) {
        for (let i = 0; i < divX; i++) {
            const a = idx(i, 0, k);
            const b = idx(i, 0, k + 1);
            const c = idx(i + 1, 0, k + 1);
            const d = idx(i + 1, 0, k);
            faces.push([a, b, c, d]);
        }
    }

    return createMesh(vertices, faces, [0.62, 0.65, 0.75]);
}

// ==========================================
// ESFERA (con triángulos en los polos, topología UV)
// Winding corregido: el polo norte mira hacia +Y, el sur hacia -Y
// ==========================================

function createSphere(segments = 32, rings = 20) {
    segments = Math.max(3, Math.floor(segments));
    rings = Math.max(2, Math.floor(rings));

    const vertices = [];
    const faces = [];

    // Construcción: para cada anillo y (0..rings), un anillo de segmentos+1 vértices.
    // En y=0 y y=rings, los vértices coinciden en el polo (arriba y abajo).
    for (let y = 0; y <= rings; y++) {
        const v = y / rings * Math.PI;
        for (let x = 0; x <= segments; x++) {
            const u = x / segments * Math.PI * 2;
            vertices.push([
                -Math.cos(u) * Math.sin(v),
                 Math.cos(v),
                 Math.sin(u) * Math.sin(v)
            ]);
        }
    }

    function vidx(x, y) {
        return y * (segments + 1) + x;
    }

    // Fila superior (polo norte, y=0)
    // El vértice del polo es el que tiene v=0 -> todos los x dan el mismo polo
    // Pero como hay "segments+1" vértices en esa fila (todos en el mismo punto),
    // usamos el vértice 0 como polo norte real.
    // Para evitar triángulos degenerados con vértices repetidos, usamos
    // el vértice x=0 del anillo 0 como polo norte y x=0 del anillo rings como sur.
    // Los demás vértices de las filas polares se dejan (no se usan en caras),
    // y se limpian al final con compactMesh.

    // Fila y=0: polo norte. Creamos triángulos [polo, b_siguiente, b_actual]
    // donde b son los vértices del anillo 1.
    for (let x = 0; x < segments; x++) {
        const a = vidx(x, 1);
        const b = vidx(x + 1, 1);
        const pole = vidx(0, 0);
        // Winding: el polo norte mira hacia +Y. Visto desde arriba (mirando -Y),
        // el triángulo debe recorrerse en sentido antihorario.
        faces.push([pole, a, b]);
    }

    // Filas intermedias (y=1..rings-2): quads
    for (let y = 1; y < rings - 1; y++) {
        for (let x = 0; x < segments; x++) {
            const a = vidx(x, y);
            const b = vidx(x, y + 1);
            const c = vidx(x + 1, y + 1);
            const d = vidx(x + 1, y);
            faces.push([a, b, c, d]);
        }
    }

    // Fila inferior (polo sur, y=rings)
    for (let x = 0; x < segments; x++) {
        const a = vidx(x, rings - 1);
        const b = vidx(x + 1, rings - 1);
        const pole = vidx(0, rings);
        // Winding: el polo sur mira hacia -Y.
        faces.push([pole, b, a]);
    }

    // Limpiar vértices huérfanos (todos los x!=0 de las filas polares)
    const mesh = createMesh(vertices, faces, [0.62, 0.65, 0.75]);
    MeshOps.compactMesh(mesh);

    return mesh;
}

// ==========================================
// CILINDRO
// ==========================================

function createCylinder(segments = 32) {
    segments = Math.max(3, Math.floor(segments));
    const vertices = [];
    const faces = [];
    for (let i = 0; i < segments; i++) {
        const a = i / segments * Math.PI * 2;
        vertices.push([Math.cos(a), -1, Math.sin(a)]);
    }
    for (let i = 0; i < segments; i++) {
        const a = i / segments * Math.PI * 2;
        vertices.push([Math.cos(a), 1, Math.sin(a)]);
    }
    const bottomCenter = vertices.length;
    vertices.push([0, -1, 0]);
    const topCenter = vertices.length;
    vertices.push([0, 1, 0]);

    // Lateral en quads
    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        faces.push([i, next, segments + next, segments + i]);
    }
    // Tapa inferior: winding hacia -Y
    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        faces.push([bottomCenter, i, next]);
    }
    // Tapa superior: winding hacia +Y
    for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        faces.push([topCenter, segments + next, segments + i]);
    }

    return createMesh(vertices, faces, [0.62, 0.65, 0.75]);
}

const Geometry = {
    Cubo: createCube,
    Esfera: createSphere,
    Cilindro: createCylinder
};