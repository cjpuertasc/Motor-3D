// ==========================================
// MODEL LAB - MESH OPERATIONS
// ==========================================

const MeshOps = {

    faceCenter(mesh, faceIndex) {
        const face = mesh.faces[faceIndex];
        if (!face || face.length === 0) return [0, 0, 0];
        let x = 0, y = 0, z = 0;
        for (const vi of face) {
            const v = mesh.vertices[vi];
            x += v[0]; y += v[1]; z += v[2];
        }
        const n = face.length;
        return [x / n, y / n, z / n];
    },

    faceNormal(mesh, faceIndex) {
        const face = mesh.faces[faceIndex];
        if (!face || face.length < 3) return [0, 1, 0];
        let nx = 0, ny = 0, nz = 0;
        for (let i = 1; i < face.length - 1; i++) {
            const a = mesh.vertices[face[0]];
            const b = mesh.vertices[face[i]];
            const c = mesh.vertices[face[i + 1]];
            const ab = Vector3.subtract(b, a);
            const ac = Vector3.subtract(c, a);
            const n = Vector3.cross(ab, ac);
            nx += n[0]; ny += n[1]; nz += n[2];
        }
        return Vector3.normalize([nx, ny, nz]);
    },

    moveFace(mesh, faceIndex, delta) {
        if (faceIndex < 0 || faceIndex >= mesh.faces.length) return false;
        const face = mesh.faces[faceIndex];
        for (const vi of face) {
            mesh.vertices[vi][0] += delta[0];
            mesh.vertices[vi][1] += delta[1];
            mesh.vertices[vi][2] += delta[2];
        }
        mesh.version++;
        return true;
    },

    extrudeFace(mesh, faceIndex, distance) {
        if (faceIndex < 0 || faceIndex >= mesh.faces.length) return false;
        const face = mesh.faces[faceIndex];
        const n = face.length;
        if (n < 3) return false;

        const normal = this.faceNormal(mesh, faceIndex);
        const offset = Vector3.multiply(normal, distance);

        const newIndices = [];
        for (const vi of face) {
            const v = mesh.vertices[vi];
            const newVi = mesh.vertices.length;
            mesh.vertices.push([v[0] + offset[0], v[1] + offset[1], v[2] + offset[2]]);
            newIndices.push(newVi);
        }

        mesh.faces[faceIndex] = newIndices.slice();

        for (let i = 0; i < n; i++) {
            const a = face[i];
            const b = face[(i + 1) % n];
            const na = newIndices[i];
            const nb = newIndices[(i + 1) % n];
            mesh.faces.push([a, b, nb, na]);
        }

        mesh.version++;
        return true;
    },

    extrudeEdge(mesh, edgeIndex, distance, direction) {
        const edge = this.edgeFromIndex(mesh, edgeIndex);
        if (!edge) return null;

        const [ia, ib] = edge;
        const va = mesh.vertices[ia];
        const vb = mesh.vertices[ib];

        let offset;
        if (direction) {
            offset = Vector3.multiply(direction, distance);
        } else {
            let nx = 0, ny = 0, nz = 0;
            for (let fi = 0; fi < mesh.faces.length; fi++) {
                const f = mesh.faces[fi];
                const n = f.length;
                for (let k = 0; k < n; k++) {
                    const a = f[k];
                    const b = f[(k + 1) % n];
                    if ((a === ia && b === ib) || (a === ib && b === ia)) {
                        const fn = this.faceNormal(mesh, fi);
                        nx += fn[0]; ny += fn[1]; nz += fn[2];
                        break;
                    }
                }
            }
            const normal = Vector3.normalize([nx, ny, nz]);
            offset = Vector3.multiply(normal, distance);
        }

        const na = mesh.vertices.length;
        mesh.vertices.push([va[0] + offset[0], va[1] + offset[1], va[2] + offset[2]]);
        const nb = mesh.vertices.length;
        mesh.vertices.push([vb[0] + offset[0], vb[1] + offset[1], vb[2] + offset[2]]);

        mesh.faces.push([ia, ib, nb, na]);

        mesh.version++;
        return [na, nb];
    },

    extrudeVertex(mesh, vertexIndex, delta) {
        const v = mesh.vertices[vertexIndex];
        if (!v) return null;
        const newVi = mesh.vertices.length;
        mesh.vertices.push([v[0] + delta[0], v[1] + delta[1], v[2] + delta[2]]);
        mesh.version++;
        return newVi;
    },

    subdivideFace(mesh, faceIndex) {
        if (faceIndex < 0 || faceIndex >= mesh.faces.length) return false;
        if (!mesh.edgeMidpoints) mesh.edgeMidpoints = new Map();

        const face = mesh.faces[faceIndex];
        const n = face.length;
        if (n !== 3 && n !== 4) return false;

        const getOrCreateMidpoint = (a, b) => {
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (mesh.edgeMidpoints.has(key)) return mesh.edgeMidpoints.get(key);
            const va = mesh.vertices[a];
            const vb = mesh.vertices[b];
            const idx = mesh.vertices.length;
            mesh.vertices.push([
                (va[0] + vb[0]) / 2,
                (va[1] + vb[1]) / 2,
                (va[2] + vb[2]) / 2
            ]);
            mesh.edgeMidpoints.set(key, idx);
            return idx;
        };

        if (n === 4) {
            const [a, b, c, d] = face;
            const ab = getOrCreateMidpoint(a, b);
            const bc = getOrCreateMidpoint(b, c);
            const cd = getOrCreateMidpoint(c, d);
            const da = getOrCreateMidpoint(d, a);
            const va = mesh.vertices[a];
            const vb = mesh.vertices[b];
            const vc = mesh.vertices[c];
            const vd = mesh.vertices[d];
            const center = mesh.vertices.length;
            mesh.vertices.push([
                (va[0] + vb[0] + vc[0] + vd[0]) / 4,
                (va[1] + vb[1] + vc[1] + vd[1]) / 4,
                (va[2] + vb[2] + vc[2] + vd[2]) / 4
            ]);
            mesh.faces.splice(faceIndex, 1,
                [a, ab, center, da],
                [ab, b, bc, center],
                [center, bc, c, cd],
                [da, center, cd, d]
            );
            mesh.version++;
            return true;
        }

        if (n === 3) {
            const [a, b, c] = face;
            const ab = getOrCreateMidpoint(a, b);
            const bc = getOrCreateMidpoint(b, c);
            const ca = getOrCreateMidpoint(c, a);
            const va = mesh.vertices[a];
            const vb = mesh.vertices[b];
            const vc = mesh.vertices[c];
            const center = mesh.vertices.length;
            mesh.vertices.push([
                (va[0] + vb[0] + vc[0]) / 3,
                (va[1] + vb[1] + vc[1]) / 3,
                (va[2] + vb[2] + vc[2]) / 3
            ]);
            mesh.faces.splice(faceIndex, 1,
                [a, ab, center, ca],
                [ab, b, bc, center],
                [ca, center, bc, c]
            );
            mesh.version++;
            return true;
        }

        return false;
    },

    deleteFace(mesh, faceIndex) {
        if (faceIndex < 0 || faceIndex >= mesh.faces.length) return false;
        mesh.faces.splice(faceIndex, 1);
        mesh.version++;
        return true;
    },

    deleteVertex(mesh, vertexIndex) {
        return this.deleteVertices(mesh, [vertexIndex]);
    },

    deleteVertices(mesh, vertexIndices) {
        if (!vertexIndices || vertexIndices.length === 0) return false;
        const set = new Set(vertexIndices);
        mesh.faces = mesh.faces.filter(face => {
            for (const vi of face) if (set.has(vi)) return false;
            return true;
        });
        this.compactMesh(mesh);
        return true;
    },

    deleteEdge(mesh, edgeIndex) {
        return this.deleteEdges(mesh, [edgeIndex]);
    },

    deleteEdges(mesh, edgeIndices) {
        if (!edgeIndices || edgeIndices.length === 0) return false;
        const edges = this.edges(mesh);
        const set = new Set(edgeIndices);
        const pairs = [];
        for (const ei of set) {
            const e = edges[ei];
            if (e) {
                pairs.push([e[0], e[1]]);
                pairs.push([e[1], e[0]]);
            }
        }
        mesh.faces = mesh.faces.filter(face => {
            const n = face.length;
            for (let i = 0; i < n; i++) {
                const a = face[i];
                const b = face[(i + 1) % n];
                for (const [pa, pb] of pairs) {
                    if (a === pa && b === pb) return false;
                }
            }
            return true;
        });
        this.compactMesh(mesh);
        return true;
    },

    mergeVertices(mesh, vertexIndices, mode = "center") {
        if (!vertexIndices || vertexIndices.length < 2) return false;
        const set = Array.from(new Set(vertexIndices));
        if (set.length < 2) return false;

        let targetPos;
        if (mode === "last") {
            const last = set[set.length - 1];
            targetPos = [...mesh.vertices[last]];
        } else {
            let x = 0, y = 0, z = 0;
            for (const vi of set) {
                const v = mesh.vertices[vi];
                x += v[0]; y += v[1]; z += v[2];
            }
            targetPos = [x / set.length, y / set.length, z / set.length];
        }

        const newIndex = mesh.vertices.length;
        mesh.vertices.push(targetPos);

        const remap = new Map();
        for (const vi of set) remap.set(vi, newIndex);

        const newFaces = [];
        for (const face of mesh.faces) {
            const newFace = [];
            for (const vi of face) {
                const mapped = remap.has(vi) ? remap.get(vi) : vi;
                if (newFace.length === 0 || newFace[newFace.length - 1] !== mapped) {
                    newFace.push(mapped);
                }
            }
            if (newFace.length > 1 && newFace[0] === newFace[newFace.length - 1]) {
                newFace.pop();
            }
            if (newFace.length >= 3) newFaces.push(newFace);
        }

        mesh.faces = newFaces;
        this.compactMesh(mesh);
        return true;
    },

    mergeEdgesToCenter(mesh, edgeIndices) {
        if (!edgeIndices || edgeIndices.length === 0) return false;
        const edges = this.edges(mesh);
        const verts = new Set();
        for (const ei of edgeIndices) {
            const e = edges[ei];
            if (e) { verts.add(e[0]); verts.add(e[1]); }
        }
        if (verts.size < 2) return false;
        return this.mergeVertices(mesh, Array.from(verts), "center");
    },

    mergeCoincidentVertices(mesh, epsilon = 0.001) {
        const n = mesh.vertices.length;
        if (n === 0) return false;

        const used = new Array(n).fill(false);
        const remap = new Array(n);
        const newVertices = [];
        const epsSq = epsilon * epsilon;

        for (let i = 0; i < n; i++) {
            if (used[i]) continue;
            const vi = mesh.vertices[i];
            const group = [i];
            used[i] = true;
            for (let j = i + 1; j < n; j++) {
                if (used[j]) continue;
                const vj = mesh.vertices[j];
                const dx = vi[0] - vj[0];
                const dy = vi[1] - vj[1];
                const dz = vi[2] - vj[2];
                if (dx*dx + dy*dy + dz*dz <= epsSq) {
                    used[j] = true;
                    group.push(j);
                }
            }
            let x = 0, y = 0, z = 0;
            for (const idx of group) {
                const v = mesh.vertices[idx];
                x += v[0]; y += v[1]; z += v[2];
            }
            const newIdx = newVertices.length;
            newVertices.push([x / group.length, y / group.length, z / group.length]);
            for (const idx of group) remap[idx] = newIdx;
        }

        const newFaces = [];
        for (const face of mesh.faces) {
            const newFace = [];
            for (const vi of face) {
                const m = remap[vi];
                if (newFace.length === 0 || newFace[newFace.length - 1] !== m) {
                    newFace.push(m);
                }
            }
            if (newFace.length > 1 && newFace[0] === newFace[newFace.length - 1]) newFace.pop();
            if (newFace.length >= 3) newFaces.push(newFace);
        }

        mesh.vertices = newVertices;
        mesh.faces = newFaces;
        mesh.version++;
        return true;
    },

    weldTJunctions(mesh, epsilon = 0.001) {
        const V = mesh.vertices;
        const epsSq = epsilon * epsilon;

        let changed = false;
        let safety = 0;
        const maxIter = 50;

        while (safety++ < maxIter) {
            const newFaces = [];
            let splitCount = 0;

            for (let fi = 0; fi < mesh.faces.length; fi++) {
                const face = mesh.faces[fi];
                const n = face.length;
                const outVerts = [];

                for (let i = 0; i < n; i++) {
                    const a = face[i];
                    const b = face[(i + 1) % n];
                    const va = V[a];
                    const vb = V[b];
                    outVerts.push(a);

                    const abx = vb[0] - va[0];
                    const aby = vb[1] - va[1];
                    const abz = vb[2] - va[2];
                    const lenSq = abx*abx + aby*aby + abz*abz;
                    if (lenSq < 1e-12) continue;

                    let bestT = -1;
                    let bestIdx = -1;

                    for (let vi = 0; vi < V.length; vi++) {
                        if (vi === a || vi === b) continue;
                        const vp = V[vi];
                        const apx = vp[0] - va[0];
                        const apy = vp[1] - va[1];
                        const apz = vp[2] - va[2];
                        let t = (apx*abx + apy*aby + apz*abz) / lenSq;
                        if (t <= 0.001 || t >= 0.999) continue;

                        const px = va[0] + abx * t;
                        const py = va[1] + aby * t;
                        const pz = va[2] + abz * t;
                        const dx = vp[0] - px;
                        const dy = vp[1] - py;
                        const dz = vp[2] - pz;
                        const dSq = dx*dx + dy*dy + dz*dz;

                        if (dSq <= epsSq) {
                            if (bestT < 0 || t < bestT) {
                                bestT = t;
                                bestIdx = vi;
                            }
                        }
                    }

                    if (bestIdx >= 0) {
                        outVerts.push(bestIdx);
                        splitCount++;
                    }
                }

                if (outVerts.length > n) {
                    const filtered = [];
                    for (const vi of outVerts) {
                        if (filtered.length === 0 || filtered[filtered.length - 1] !== vi) {
                            filtered.push(vi);
                        }
                    }
                    if (filtered.length > 1 && filtered[0] === filtered[filtered.length - 1]) {
                        filtered.pop();
                    }
                    if (filtered.length >= 3) newFaces.push(filtered);
                } else {
                    newFaces.push(face);
                }
            }

            if (splitCount === 0) break;
            mesh.faces = newFaces;
            changed = true;
        }

        if (changed) mesh.version++;
        return changed;
    },

    fixWinding(mesh) {
        if (!mesh.faces || mesh.faces.length === 0) return false;

        const edgeFaces = new Map();
        for (let fi = 0; fi < mesh.faces.length; fi++) {
            const face = mesh.faces[fi];
            const n = face.length;
            for (let i = 0; i < n; i++) {
                const a = face[i];
                const b = face[(i + 1) % n];
                const key = a < b ? `${a}_${b}` : `${b}_${a}`;
                if (!edgeFaces.has(key)) edgeFaces.set(key, []);
                edgeFaces.get(key).push({ fi, dir: a < b ? 1 : -1 });
            }
        }

        const visited = new Array(mesh.faces.length).fill(false);
        const flip = new Array(mesh.faces.length).fill(false);

        for (let startFi = 0; startFi < mesh.faces.length; startFi++) {
            if (visited[startFi]) continue;
            visited[startFi] = true;
            const queue = [startFi];
            while (queue.length > 0) {
                const fi = queue.shift();
                const face = mesh.faces[fi];
                const n = face.length;
                for (let i = 0; i < n; i++) {
                    const a = face[i];
                    const b = face[(i + 1) % n];
                    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
                    const list = edgeFaces.get(key);
                    if (!list) continue;
                    for (const entry of list) {
                        if (entry.fi === fi) continue;
                        if (visited[entry.fi]) continue;
                        const fiDir = a < b ? 1 : -1;
                        const neighborDir = entry.dir;
                        const fiEffectiveDir = fiDir * (flip[fi] ? -1 : 1);
                        const nbEffectiveDir = neighborDir * (flip[entry.fi] ? -1 : 1);
                        if (fiEffectiveDir === nbEffectiveDir) {
                            flip[entry.fi] = !flip[entry.fi];
                        }
                        visited[entry.fi] = true;
                        queue.push(entry.fi);
                    }
                }
            }
        }

        let flippedCount = 0;
        for (let fi = 0; fi < mesh.faces.length; fi++) {
            if (flip[fi]) {
                mesh.faces[fi] = mesh.faces[fi].slice().reverse();
                flippedCount++;
            }
        }

        if (flippedCount > 0) mesh.version++;
        return flippedCount > 0;
    },

    fixWindingByComponent(mesh) {
        if (!mesh.faces || mesh.faces.length === 0) return false;

        const faceAdj = new Map();
        const vertToFaces = new Map();
        for (let fi = 0; fi < mesh.faces.length; fi++) {
            faceAdj.set(fi, new Set());
            for (const vi of mesh.faces[fi]) {
                if (!vertToFaces.has(vi)) vertToFaces.set(vi, []);
                vertToFaces.get(vi).push(fi);
            }
        }
        for (const [, faces] of vertToFaces) {
            for (let i = 0; i < faces.length; i++) {
                for (let j = i + 1; j < faces.length; j++) {
                    faceAdj.get(faces[i]).add(faces[j]);
                    faceAdj.get(faces[j]).add(faces[i]);
                }
            }
        }

        const visited = new Array(mesh.faces.length).fill(false);
        let flippedTotal = 0;

        for (let startFi = 0; startFi < mesh.faces.length; startFi++) {
            if (visited[startFi]) continue;

            const component = [];
            const stack = [startFi];
            visited[startFi] = true;
            while (stack.length > 0) {
                const fi = stack.pop();
                component.push(fi);
                for (const nb of faceAdj.get(fi)) {
                    if (!visited[nb]) {
                        visited[nb] = true;
                        stack.push(nb);
                    }
                }
            }

            let cx = 0, cy = 0, cz = 0, count = 0;
            for (const fi of component) {
                const face = mesh.faces[fi];
                for (const vi of face) {
                    const v = mesh.vertices[vi];
                    cx += v[0]; cy += v[1]; cz += v[2];
                    count++;
                }
            }
            if (count === 0) continue;
            cx /= count; cy /= count; cz /= count;

            for (const fi of component) {
                const face = mesh.faces[fi];
                if (face.length < 3) continue;
                const n = this.faceNormal(mesh, fi);
                const fc = this.faceCenter(mesh, fi);
                const dx = fc[0] - cx, dy = fc[1] - cy, dz = fc[2] - cz;
                const dot = n[0]*dx + n[1]*dy + n[2]*dz;
                if (dot < 0) {
                    mesh.faces[fi] = face.slice().reverse();
                    flippedTotal++;
                }
            }
        }

        if (flippedTotal > 0) mesh.version++;
        return flippedTotal > 0;
    },

    combineMeshes(items, weldEpsilon = 0.01) {
        const allVertices = [];
        const allFaces = [];

        for (const item of items) {
            const m = Matrix4.compose(
                item.position, item.rotation, item.scale, item.pivot
            );
            const offset = allVertices.length;

            for (const v of item.mesh.vertices) {
                const x = v[0], y = v[1], z = v[2];
                allVertices.push([
                    m[0]*x + m[4]*y + m[8] *z + m[12],
                    m[1]*x + m[5]*y + m[9] *z + m[13],
                    m[2]*x + m[6]*y + m[10]*z + m[14]
                ]);
            }

            for (const face of item.mesh.faces) {
                allFaces.push(face.map(vi => vi + offset));
            }
        }

        const combined = {
            vertices: allVertices,
            faces: allFaces,
            color: [...items[0].mesh.color],
            version: 0,
            edgeMidpoints: new Map()
        };

        this.weldTJunctions(combined, weldEpsilon);
        this.mergeCoincidentVertices(combined, weldEpsilon);
        this.weldTJunctions(combined, weldEpsilon);
        this.fixWindingByComponent(combined);

        return combined;
    },

    connectedComponent(mesh, vertexIndex) {
        const result = new Set([vertexIndex]);
        const stack = [vertexIndex];
        const edges = this.edges(mesh);
        const adj = new Map();
        for (const [a, b] of edges) {
            if (!adj.has(a)) adj.set(a, []);
            if (!adj.has(b)) adj.set(b, []);
            adj.get(a).push(b);
            adj.get(b).push(a);
        }
        while (stack.length > 0) {
            const v = stack.pop();
            const neighbors = adj.get(v) || [];
            for (const nb of neighbors) {
                if (!result.has(nb)) {
                    result.add(nb);
                    stack.push(nb);
                }
            }
        }
        return result;
    },

    connectedComponentEdges(mesh, edgeIndex) {
        const edge = this.edgeFromIndex(mesh, edgeIndex);
        if (!edge) return new Set();
        const verts = this.connectedComponent(mesh, edge[0]);
        const edges = this.edges(mesh);
        const result = new Set();
        for (let i = 0; i < edges.length; i++) {
            if (verts.has(edges[i][0]) && verts.has(edges[i][1])) {
                result.add(i);
            }
        }
        return result;
    },

    connectedComponentFaces(mesh, faceIndex) {
        const face = mesh.faces[faceIndex];
        if (!face) return new Set();
        const verts = this.connectedComponent(mesh, face[0]);
        const result = new Set();
        for (let fi = 0; fi < mesh.faces.length; fi++) {
            const f = mesh.faces[fi];
            let allIn = true;
            for (const vi of f) {
                if (!verts.has(vi)) { allIn = false; break; }
            }
            if (allIn) result.add(fi);
        }
        return result;
    },

    findEdgeComponents(mesh, edgeIndices) {
        const edges = this.edges(mesh);
        const selected = new Set(edgeIndices);
        const visited = new Set();
        const components = [];

        for (const startEi of selected) {
            if (visited.has(startEi)) continue;
            const comp = [];
            const stack = [startEi];
            visited.add(startEi);
            while (stack.length > 0) {
                const ei = stack.pop();
                comp.push(ei);
                const e = edges[ei];
                if (!e) continue;
                for (const otherEi of selected) {
                    if (visited.has(otherEi)) continue;
                    const oe = edges[otherEi];
                    if (!oe) continue;
                    if (oe[0] === e[0] || oe[0] === e[1] ||
                        oe[1] === e[0] || oe[1] === e[1]) {
                        visited.add(otherEi);
                        stack.push(otherEi);
                    }
                }
            }
            components.push(comp);
        }

        return components;
    },

    bridgeFaces(mesh, faceIndexA, faceIndexB) {
        if (faceIndexA === faceIndexB) return false;
        const faceA = mesh.faces[faceIndexA];
        const faceB = mesh.faces[faceIndexB];
        if (!faceA || !faceB) return false;
        const n = faceA.length;
        if (n !== faceB.length || n < 3) return false;

        const loopA = faceA.slice();
        const loopB = this.alignChain(mesh, faceA, faceB, true);

        const toDelete = [faceIndexA, faceIndexB].sort((a, b) => b - a);
        for (const fi of toDelete) mesh.faces.splice(fi, 1);

        for (let i = 0; i < n; i++) {
            const a0 = loopA[i];
            const a1 = loopA[(i + 1) % n];
            const b0 = loopB[i];
            const b1 = loopB[(i + 1) % n];
            mesh.faces.push([a0, a1, b1, b0]);
        }

        mesh.version++;
        this.fixWindingByComponent(mesh);
        return true;
    },

    edgeChains(mesh, edgeIndices) {
        const edges = this.edges(mesh);
        const adj = new Map();
        for (const ei of new Set(edgeIndices)) {
            const e = edges[ei];
            if (!e) continue;
            if (!adj.has(e[0])) adj.set(e[0], []);
            if (!adj.has(e[1])) adj.set(e[1], []);
            adj.get(e[0]).push(e[1]);
            adj.get(e[1]).push(e[0]);
        }
        for (const list of adj.values()) if (list.length > 2) return null;

        const seen = new Set();
        const chains = [];
        const walk = start => {
            const verts = [start];
            seen.add(start);
            let prev = null, cur = start;
            for (;;) {
                let next = null;
                for (const v of adj.get(cur)) {
                    if (v !== prev && !seen.has(v)) { next = v; break; }
                }
                if (next === null) break;
                verts.push(next);
                seen.add(next);
                prev = cur;
                cur = next;
            }
            const closed = verts.length >= 3 && adj.get(cur).includes(start);
            chains.push({ verts, closed });
        };
        for (const [v, list] of adj) if (list.length === 1 && !seen.has(v)) walk(v);
        for (const v of adj.keys()) if (!seen.has(v)) walk(v);
        return chains;
    },

    alignChain(mesh, A, B, closed) {
        const V = mesh.vertices;
        const n = A.length;
        const d2 = (p, q) => (p[0]-q[0])**2 + (p[1]-q[1])**2 + (p[2]-q[2])**2;
        let best = null, bestCost = Infinity;
        for (const dir of [1, -1]) {
            const rots = closed ? n : 1;
            for (let r = 0; r < rots; r++) {
                let cost = 0;
                const idx = i => closed ? (((r + dir * i) % n) + n) % n : (dir === 1 ? i : n - 1 - i);
                for (let i = 0; i < n; i++) cost += d2(V[A[i]], V[B[idx(i)]]);
                if (cost < bestCost - 1e-12) {
                    bestCost = cost;
                    best = { dir, r, idx };
                }
            }
        }
        return A.map((_, i) => B[best.idx(i)]);
    },

    bridgeEdgeSelection(mesh, edgeIndices, dryRun = false) {
        const chains = this.edgeChains(mesh, edgeIndices);
        if (!chains) return { ok: false, reason: "Cada vértice puede tener máximo 2 aristas seleccionadas" };
        if (chains.length !== 2) return { ok: false, reason: "Selecciona exactamente 2 cadenas de aristas (hay " + chains.length + ")" };

        const [A, B] = chains;
        if (A.closed !== B.closed) return { ok: false, reason: "Ambas cadenas deben ser cerradas o ambas abiertas" };
        if (A.verts.length !== B.verts.length) {
            return { ok: false, reason: "Deben tener la misma cantidad de aristas (" + (A.closed ? A.verts.length : A.verts.length - 1) + " vs " + (B.closed ? B.verts.length : B.verts.length - 1) + ")" };
        }
        const inA = new Set(A.verts);
        if (B.verts.some(v => inA.has(v))) return { ok: false, reason: "Las cadenas comparten vértices" };
        if (dryRun) return { ok: true };

        const n = A.verts.length;
        const Bv = this.alignChain(mesh, A.verts, B.verts, A.closed);
        const segs = A.closed ? n : n - 1;
        for (let i = 0; i < segs; i++) {
            const j = (i + 1) % n;
            mesh.faces.push([A.verts[i], A.verts[j], Bv[j], Bv[i]]);
        }
        mesh.version++;
        this.fixWindingByComponent(mesh);
        return { ok: true };
    },

    bridgeEdges(mesh, edgeIndexA, edgeIndexB) {
        return this.bridgeEdgeSelection(mesh, [edgeIndexA, edgeIndexB]).ok;
    },

    bridgeEdgeLoops(mesh, loopAIndices, loopBIndices) {
        return this.bridgeEdgeSelection(mesh, [...loopAIndices, ...loopBIndices]).ok;
    },

    edgeLoop(mesh, edgeIndex) {
        const edges = this.edges(mesh);
        const start = edges[edgeIndex];
        if (!start) return new Set();

        const result = new Set();
        result.add(edgeIndex);

        const edgeToFaces = new Map();
        for (let fi = 0; fi < mesh.faces.length; fi++) {
            const face = mesh.faces[fi];
            const n = face.length;
            for (let i = 0; i < n; i++) {
                const a = face[i];
                const b = face[(i + 1) % n];
                const key = a < b ? `${a}_${b}` : `${b}_${a}`;
                if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
                edgeToFaces.get(key).push(fi);
            }
        }

        const VA = mesh.vertices;

        function findNextEdge(currentEdge, vertex) {
            const key0 = currentEdge[0] < currentEdge[1]
                ? `${currentEdge[0]}_${currentEdge[1]}`
                : `${currentEdge[1]}_${currentEdge[0]}`;
            const facesOfCurrent = edgeToFaces.get(key0) || [];

            const curA = VA[currentEdge[0]];
            const curB = VA[currentEdge[1]];
            const curDir = [
                curB[0] - curA[0],
                curB[1] - curA[1],
                curB[2] - curA[2]
            ];
            const curLen = Math.hypot(curDir[0], curDir[1], curDir[2]) || 1;
            const ux = curDir[0] / curLen;
            const uy = curDir[1] / curLen;
            const uz = curDir[2] / curLen;

            let bestEdge = null;
            let bestDot = -2;

            for (let i = 0; i < edges.length; i++) {
                const e = edges[i];
                if (e[0] !== vertex && e[1] !== vertex) continue;
                if (e[0] === currentEdge[0] && e[1] === currentEdge[1]) continue;
                if (e[0] === currentEdge[1] && e[1] === currentEdge[0]) continue;

                const keyE = e[0] < e[1] ? `${e[0]}_${e[1]}` : `${e[1]}_${e[0]}`;
                const facesOfE = edgeToFaces.get(keyE) || [];
                let sharesFace = false;
                for (const f1 of facesOfCurrent) {
                    for (const f2 of facesOfE) {
                        if (f1 === f2) { sharesFace = true; break; }
                    }
                    if (sharesFace) break;
                }
                if (sharesFace) continue;

                const other = e[0] === vertex ? e[1] : e[0];
                const vo = VA[vertex];
                const ve = VA[other];
                const dx = ve[0] - vo[0];
                const dy = ve[1] - vo[1];
                const dz = ve[2] - vo[2];
                const len = Math.hypot(dx, dy, dz) || 1;
                const ex = dx / len, ey = dy / len, ez = dz / len;

                let fx = ux, fy = uy, fz = uz;
                if (vertex === currentEdge[1]) {
                    fx = -ux; fy = -uy; fz = -uz;
                }

                const dot = ex * fx + ey * fy + ez * fz;
                if (dot > bestDot) {
                    bestDot = dot;
                    bestEdge = i;
                }
            }

            return bestEdge;
        }

        function walk(startEdgeIdx, startVertex) {
            let currentIdx = startEdgeIdx;
            let currentEdge = edges[currentIdx];
            let vertex = startVertex;
            let steps = 0;
            while (steps++ < 1000) {
                const nextIdx = findNextEdge(currentEdge, vertex);
                if (nextIdx === null) break;
                if (result.has(nextIdx)) break;
                result.add(nextIdx);
                const ne = edges[nextIdx];
                vertex = ne[0] === vertex ? ne[1] : ne[0];
                currentEdge = ne;
                currentIdx = nextIdx;
            }
        }

        walk(edgeIndex, start[0]);
        walk(edgeIndex, start[1]);

        return result;
    },

    faceLoop(mesh, startFace, nextFace) {
        const result = new Set();
        result.add(startFace);
        result.add(nextFace);

        function findOppositeFace(fromFace, cameFromFace) {
            const f = mesh.faces[fromFace];
            const cf = mesh.faces[cameFromFace];
            if (!f || !cf) return null;

            const sharedEdgeVerts = [];
            for (const vi of f) {
                if (cf.includes(vi)) sharedEdgeVerts.push(vi);
            }
            if (sharedEdgeVerts.length !== 2) return null;

            const oppositeVerts = f.filter(vi => !sharedEdgeVerts.includes(vi));
            if (oppositeVerts.length < 2) return null;

            const va = oppositeVerts[0];
            const vb = oppositeVerts[1];
            for (let fi = 0; fi < mesh.faces.length; fi++) {
                if (fi === fromFace) continue;
                const face = mesh.faces[fi];
                if (face.includes(va) && face.includes(vb)) {
                    if (fi === cameFromFace) continue;
                    return fi;
                }
            }
            return null;
        }

        let prev = startFace;
        let curr = nextFace;
        let steps = 0;
        while (steps++ < 1000) {
            const next = findOppositeFace(curr, prev);
            if (next === null || result.has(next)) break;
            result.add(next);
            prev = curr;
            curr = next;
        }

        prev = nextFace;
        curr = startFace;
        steps = 0;
        while (steps++ < 1000) {
            const next = findOppositeFace(curr, prev);
            if (next === null || result.has(next)) break;
            result.add(next);
            prev = curr;
            curr = next;
        }

        return result;
    },

    compactMesh(mesh) {
        const used = new Set();
        for (const face of mesh.faces) {
            for (const vi of face) used.add(vi);
        }
        const remap = new Map();
        const newVertices = [];
        for (let i = 0; i < mesh.vertices.length; i++) {
            if (used.has(i)) {
                remap.set(i, newVertices.length);
                newVertices.push(mesh.vertices[i]);
            }
        }
        const newFaces = mesh.faces.map(face => face.map(vi => remap.get(vi)));
        mesh.vertices = newVertices;
        mesh.faces = newFaces;
        mesh.edgeMidpoints = new Map();
        mesh.version++;
        return true;
    },

    edges(mesh) {
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
    },

    edgeFromIndex(mesh, edgeIndex) {
        const edges = this.edges(mesh);
        return edges[edgeIndex] || null;
    },

    separateMeshByComponents(mesh) {
        if (!mesh.faces || mesh.faces.length === 0) return [mesh];

        const faceAdj = new Map();
        const vertToFaces = new Map();
        for (let fi = 0; fi < mesh.faces.length; fi++) {
            faceAdj.set(fi, new Set());
            for (const vi of mesh.faces[fi]) {
                if (!vertToFaces.has(vi)) vertToFaces.set(vi, []);
                vertToFaces.get(vi).push(fi);
            }
        }
        for (const [, faces] of vertToFaces) {
            for (let i = 0; i < faces.length; i++) {
                for (let j = i + 1; j < faces.length; j++) {
                    faceAdj.get(faces[i]).add(faces[j]);
                    faceAdj.get(faces[j]).add(faces[i]);
                }
            }
        }

        const visited = new Array(mesh.faces.length).fill(false);
        const components = [];

        for (let startFi = 0; startFi < mesh.faces.length; startFi++) {
            if (visited[startFi]) continue;
            const comp = [];
            const stack = [startFi];
            visited[startFi] = true;
            while (stack.length > 0) {
                const fi = stack.pop();
                comp.push(fi);
                for (const nb of faceAdj.get(fi)) {
                    if (!visited[nb]) {
                        visited[nb] = true;
                        stack.push(nb);
                    }
                }
            }
            components.push(comp);
        }

        if (components.length <= 1) return [mesh];

        const result = [];
        for (const comp of components) {
            const vertexMap = new Map();
            const vertices = [];
            const faces = [];

            for (const fi of comp) {
                const face = mesh.faces[fi];
                const newFace = [];
                for (const vi of face) {
                    if (!vertexMap.has(vi)) {
                        vertexMap.set(vi, vertices.length);
                        vertices.push([...mesh.vertices[vi]]);
                    }
                    newFace.push(vertexMap.get(vi));
                }
                faces.push(newFace);
            }

            result.push({
                vertices,
                faces,
                color: [...mesh.color],
                version: 0,
                edgeMidpoints: new Map()
            });
        }

        return result;
    },

    applyTransformToVertices(mesh, position, rotation, scale, pivot) {
        const m = Matrix4.compose(position, rotation, scale, pivot);

        for (const v of mesh.vertices) {
            const x = v[0], y = v[1], z = v[2];
            v[0] = m[0]*x + m[4]*y + m[8] *z + m[12];
            v[1] = m[1]*x + m[5]*y + m[9] *z + m[13];
            v[2] = m[2]*x + m[6]*y + m[10]*z + m[14];
        }

        mesh.version++;
        return true;
    },

    knifeCutSegment(mesh, pointA, pointB) {
        if (!pointA || !pointB) return false;
        if (!mesh.faces || mesh.faces.length === 0) return false;

        const distAB = Math.hypot(
            pointB[0] - pointA[0],
            pointB[1] - pointA[1],
            pointB[2] - pointA[2]
        );
        if (distAB < 1e-6) return false;

        const VA = mesh.vertices;

        const cutEdgeVerts = new Map();
        const cutFaceVerts = new Map();

        function getOrCreateVertex(fi, face, P) {
            for (const vi of face) {
                const v = VA[vi];
                const d = Math.hypot(v[0]-P[0], v[1]-P[1], v[2]-P[2]);
                if (d < 0.001) return vi;
            }

            const n = face.length;
            for (let i = 0; i < n; i++) {
                const a = face[i];
                const b = face[(i + 1) % n];
                const va = VA[a];
                const vb = VA[b];

                const abx = vb[0]-va[0], aby = vb[1]-va[1], abz = vb[2]-va[2];
                const apx = P[0]-va[0], apy = P[1]-va[1], apz = P[2]-va[2];
                const lenSq = abx*abx + aby*aby + abz*abz;
                if (lenSq < 1e-12) continue;

                let t = (apx*abx + apy*aby + apz*abz) / lenSq;
                if (t < -0.001 || t > 1.001) continue;
                t = Math.max(0, Math.min(1, t));

                const projx = va[0] + abx*t;
                const projy = va[1] + aby*t;
                const projz = va[2] + abz*t;
                const d = Math.hypot(P[0]-projx, P[1]-projy, P[2]-projz);

                if (d < 0.005) {
                    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
                    if (cutEdgeVerts.has(key)) return cutEdgeVerts.get(key);
                    const newVi = VA.length;
                    VA.push([projx, projy, projz]);
                    cutEdgeVerts.set(key, newVi);
                    return newVi;
                }
            }

            for (const [key, vi] of cutFaceVerts) {
                if (!key.startsWith(`f${fi}_`)) continue;
                const v = VA[vi];
                const d = Math.hypot(v[0]-P[0], v[1]-P[1], v[2]-P[2]);
                if (d < 0.001) return vi;
            }
            const newVi = VA.length;
            VA.push([P[0], P[1], P[2]]);
            cutFaceVerts.set(`f${fi}_${newVi}`, newVi);
            return newVi;
        }

        function pointInPolygon2D(pt, poly) {
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const xi = poly[i][0], yi = poly[i][1];
                const xj = poly[j][0], yj = poly[j][1];
                const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
                    (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi + 1e-12) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }

        function pointOnPolygonBorder(pt, poly, eps) {
            for (let i = 0; i < poly.length; i++) {
                const a = poly[i];
                const b = poly[(i + 1) % poly.length];
                const abx = b[0]-a[0], aby = b[1]-a[1];
                const lenSq = abx*abx + aby*aby;
                if (lenSq < 1e-12) continue;
                let t = ((pt[0]-a[0])*abx + (pt[1]-a[1])*aby) / lenSq;
                if (t < -0.001 || t > 1.001) continue;
                t = Math.max(0, Math.min(1, t));
                const px = a[0] + abx*t;
                const py = a[1] + aby*t;
                const d = Math.hypot(pt[0]-px, pt[1]-py);
                if (d < eps) return true;
            }
            return false;
        }

        const newFaces = [];
        let anySplit = false;

        for (let fi = 0; fi < mesh.faces.length; fi++) {
            const face = mesh.faces[fi];
            if (face.length < 3) {
                newFaces.push(face);
                continue;
            }

            const fn = this.faceNormal(mesh, fi);
            const fc = this.faceCenter(mesh, fi);

            const dA = (pointA[0]-fc[0])*fn[0] + (pointA[1]-fc[1])*fn[1] + (pointA[2]-fc[2])*fn[2];
            const dB = (pointB[0]-fc[0])*fn[0] + (pointB[1]-fc[1])*fn[1] + (pointB[2]-fc[2])*fn[2];

            const EPS = 0.1;
            if (Math.abs(dA) > EPS || Math.abs(dB) > EPS) {
                newFaces.push(face);
                continue;
            }

            const aP = [pointA[0] - dA * fn[0], pointA[1] - dA * fn[1], pointA[2] - dA * fn[2]];
            const bP = [pointB[0] - dB * fn[0], pointB[1] - dB * fn[1], pointB[2] - dB * fn[2]];

            const e1 = Vector3.normalize(Vector3.subtract(VA[face[0]], fc));
            const e2 = Vector3.cross(fn, e1);

            function to2D(p) {
                const v = [p[0]-fc[0], p[1]-fc[1], p[2]-fc[2]];
                return [
                    v[0]*e1[0] + v[1]*e1[1] + v[2]*e1[2],
                    v[0]*e2[0] + v[1]*e2[1] + v[2]*e2[2]
                ];
            }

            const poly2D = face.map(vi => to2D(VA[vi]));
            const a2 = to2D(aP);
            const b2 = to2D(bP);

            const aInPoly = pointInPolygon2D(a2, poly2D) || pointOnPolygonBorder(a2, poly2D, 0.005);
            const bInPoly = pointInPolygon2D(b2, poly2D) || pointOnPolygonBorder(b2, poly2D, 0.005);

            const intersections = [];
            for (let i = 0; i < face.length; i++) {
                const ia = face[i];
                const ib = face[(i + 1) % face.length];
                const va2 = poly2D[i];
                const vb2 = poly2D[(i + 1) % face.length];

                const d1x = b2[0]-a2[0], d1y = b2[1]-a2[1];
                const d2x = vb2[0]-va2[0], d2y = vb2[1]-va2[1];
                const rx = a2[0]-va2[0], ry = a2[1]-va2[1];
                const denom = d1x*d2y - d1y*d2x;
                if (Math.abs(denom) < 1e-9) continue;
                const s = (rx*d2y - ry*d2x) / denom;
                const t = (rx*d1y - ry*d1x) / denom;
                if (s < -0.001 || s > 1.001) continue;
                if (t < -0.001 || t > 1.001) continue;
                const tClamped = Math.max(0, Math.min(1, t));
                intersections.push({
                    edgeIndex: i,
                    ia, ib, t: tClamped,
                    point: [
                        VA[ia][0] + (VA[ib][0]-VA[ia][0]) * tClamped,
                        VA[ia][1] + (VA[ib][1]-VA[ia][1]) * tClamped,
                        VA[ia][2] + (VA[ib][2]-VA[ia][2]) * tClamped
                    ]
                });
            }

            let cutP1, cutP2;

            if (aInPoly && bInPoly) {
                const allCutPoints = [{ point: aP }, { point: bP }];
                for (const int of intersections) {
                    const nearA = Math.hypot(int.point[0]-aP[0], int.point[1]-aP[1], int.point[2]-aP[2]) < 0.005;
                    const nearB = Math.hypot(int.point[0]-bP[0], int.point[1]-bP[1], int.point[2]-bP[2]) < 0.005;
                    if (nearA || nearB) continue;
                    allCutPoints.push({ point: int.point });
                }
                allCutPoints.sort((x, y) => {
                    const dx = (x.point[0]-aP[0])**2 + (x.point[1]-aP[1])**2 + (x.point[2]-aP[2])**2;
                    const dy = (y.point[0]-aP[0])**2 + (y.point[1]-aP[1])**2 + (y.point[2]-aP[2])**2;
                    return dx - dy;
                });
                cutP1 = allCutPoints[0].point;
                cutP2 = allCutPoints[allCutPoints.length - 1].point;
            } else if ((aInPoly || bInPoly) && intersections.length >= 1) {
                const insidePoint = aInPoly ? aP : bP;
                const allCutPoints = [{ point: insidePoint }];
                for (const int of intersections) {
                    const near = Math.hypot(int.point[0]-insidePoint[0], int.point[1]-insidePoint[1], int.point[2]-insidePoint[2]) < 0.005;
                    if (near) continue;
                    allCutPoints.push({ point: int.point });
                }
                if (allCutPoints.length < 2) { newFaces.push(face); continue; }
                allCutPoints.sort((x, y) => {
                    const dx = (x.point[0]-aP[0])**2 + (x.point[1]-aP[1])**2 + (x.point[2]-aP[2])**2;
                    const dy = (y.point[0]-aP[0])**2 + (y.point[1]-aP[1])**2 + (y.point[2]-aP[2])**2;
                    return dx - dy;
                });
                cutP1 = allCutPoints[0].point;
                cutP2 = allCutPoints[allCutPoints.length - 1].point;
            } else {
                if (intersections.length < 2) { newFaces.push(face); continue; }
                intersections.sort((x, y) => {
                    const dx = (x.point[0]-aP[0])**2 + (x.point[1]-aP[1])**2 + (x.point[2]-aP[2])**2;
                    const dy = (y.point[0]-aP[0])**2 + (y.point[1]-aP[1])**2 + (y.point[2]-aP[2])**2;
                    return dx - dy;
                });
                cutP1 = intersections[0].point;
                cutP2 = intersections[intersections.length - 1].point;
            }

            const cutDist = Math.hypot(cutP2[0]-cutP1[0], cutP2[1]-cutP1[1], cutP2[2]-cutP1[2]);
            if (cutDist < 0.001) { newFaces.push(face); continue; }

            const vIdx1 = getOrCreateVertex(fi, face, cutP1);
            const vIdx2 = getOrCreateVertex(fi, face, cutP2);
            if (vIdx1 === vIdx2) { newFaces.push(face); continue; }

            const extended = [];
            const n = face.length;
            for (let i = 0; i < n; i++) {
                const a = face[i];
                const b = face[(i + 1) % n];
                extended.push(a);
                const key = a < b ? `${a}_${b}` : `${b}_${a}`;
                if (cutEdgeVerts.has(key)) {
                    const cv = cutEdgeVerts.get(key);
                    if (cv !== a && cv !== b && !extended.includes(cv)) {
                        extended.push(cv);
                    }
                }
            }

            function ensureInExtended(idx) {
                if (extended.includes(idx)) return;
                const pos = VA[idx];
                let bestI = 0, bestD = Infinity;
                for (let i = 0; i < extended.length; i++) {
                    const v = VA[extended[i]];
                    const d = (v[0]-pos[0])**2 + (v[1]-pos[1])**2 + (v[2]-pos[2])**2;
                    if (d < bestD) { bestD = d; bestI = i; }
                }
                extended.splice(bestI + 1, 0, idx);
            }
            ensureInExtended(vIdx1);
            ensureInExtended(vIdx2);

            const extIdx1 = extended.indexOf(vIdx1);
            const extIdx2 = extended.indexOf(vIdx2);
            if (extIdx1 === -1 || extIdx2 === -1) { newFaces.push(face); continue; }

            const polyA = [];
            let i = extIdx1;
            while (true) {
                polyA.push(extended[i]);
                if (i === extIdx2) break;
                i = (i + 1) % extended.length;
            }

            const polyB = [];
            i = extIdx2;
            while (true) {
                polyB.push(extended[i]);
                if (i === extIdx1) break;
                i = (i + 1) % extended.length;
            }

            function cleanPoly(poly) {
                const out = [];
                for (const vi of poly) {
                    if (out.length === 0 || out[out.length - 1] !== vi) out.push(vi);
                }
                if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
                return out;
            }

            const cleanA = cleanPoly(polyA);
            const cleanB = cleanPoly(polyB);
            if (cleanA.length >= 3) newFaces.push(cleanA);
            if (cleanB.length >= 3) newFaces.push(cleanB);
            anySplit = true;
        }

        if (!anySplit) return false;

        mesh.faces = newFaces;
        mesh.version++;
        this.fixWindingByComponent(mesh);
        this.compactMesh(mesh);
        return true;
    },

    loopCutTValues(position = 0.5, count = 1, spread = 0.6) {
        count = Math.max(1, Math.min(10, Math.floor(count)));
        spread = Math.max(0, Math.min(0.8, spread));
        const clamp = t => Math.max(0.01, Math.min(0.99, t));
        if (count === 1) return [clamp(position)];
        const start = Math.max(0.01, position - spread / 2);
        const end = Math.min(0.99, position + spread / 2);
        const span = end - start;
        const out = [];
        for (let i = 0; i < count; i++) {
            out.push(span < 0.001 ? clamp(position) : clamp(start + (span * i) / (count - 1)));
        }
        return out;
    },

    loopRing(mesh, edgeIndex) {
        const startEdge = this.edges(mesh)[edgeIndex];
        if (!startEdge) return null;
        const keyOf = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;

        const edgeToFaces = new Map();
        for (let fi = 0; fi < mesh.faces.length; fi++) {
            const face = mesh.faces[fi];
            for (let i = 0; i < face.length; i++) {
                const k = keyOf(face[i], face[(i + 1) % face.length]);
                if (!edgeToFaces.has(k)) edgeToFaces.set(k, []);
                edgeToFaces.get(k).push(fi);
            }
        }

        const laterals = new Map();
        const faces = [];
        const visited = new Set();
        const first = { s: startEdge[0], e: startEdge[1] };
        const queue = [first];
        laterals.set(keyOf(first.s, first.e), first);

        while (queue.length) {
            const cur = queue.shift();
            for (const fi of edgeToFaces.get(keyOf(cur.s, cur.e)) || []) {
                if (visited.has(fi)) continue;
                const face = mesh.faces[fi];
                if (face.length !== 4) continue;
                visited.add(fi);

                let i = 0;
                for (; i < 4; i++) {
                    const a = face[i], b = face[(i + 1) % 4];
                    if ((a === cur.s && b === cur.e) || (a === cur.e && b === cur.s)) break;
                }
                const forward = face[i] === cur.s;
                const opp = forward
                    ? { s: face[(i + 3) % 4], e: face[(i + 2) % 4] }
                    : { s: face[(i + 2) % 4], e: face[(i + 3) % 4] };
                const k2 = keyOf(opp.s, opp.e);
                if (!laterals.has(k2)) {
                    laterals.set(k2, opp);
                    queue.push(opp);
                }
                faces.push({ fi, i, k1: keyOf(cur.s, cur.e), k2 });
            }
        }
        return { faces, laterals };
    },

    loopCutFromEdge(mesh, edgeIndex, position = 0.5, count = 1, spread = 0.6) {
        const ring = this.loopRing(mesh, edgeIndex);
        if (!ring || ring.faces.length === 0) return false;

        const tValues = this.loopCutTValues(position, count, spread);

        const latVerts = new Map();
        for (const [key, { s, e }] of ring.laterals) {
            const va = mesh.vertices[s], vb = mesh.vertices[e];
            latVerts.set(key, tValues.map(t => {
                mesh.vertices.push([
                    va[0] + (vb[0] - va[0]) * t,
                    va[1] + (vb[1] - va[1]) * t,
                    va[2] + (vb[2] - va[2]) * t
                ]);
                return mesh.vertices.length - 1;
            }));
        }

        const ringInfo = new Map(ring.faces.map(f => [f.fi, f]));
        const newFaces = [];

        for (let fi = 0; fi < mesh.faces.length; fi++) {
            const info = ringInfo.get(fi);
            if (!info) { newFaces.push(mesh.faces[fi]); continue; }

            const f = mesh.faces[fi];
            const { i } = info;
            const l1 = ring.laterals.get(info.k1);
            const l2 = ring.laterals.get(info.k2);

            const pts1 = latVerts.get(info.k1).slice();
            if (l1.s !== f[i]) pts1.reverse();
            const pts2 = latVerts.get(info.k2).slice();
            if (l2.s !== f[(i + 3) % 4]) pts2.reverse();

            const A = [f[i], ...pts1, f[(i + 1) % 4]];
            const B = [f[(i + 3) % 4], ...pts2, f[(i + 2) % 4]];
            for (let r = 0; r < A.length - 1; r++) {
                newFaces.push([A[r], A[r + 1], B[r + 1], B[r]]);
            }
        }

        mesh.faces = newFaces;
        mesh.version++;
        return true;
    },

    // ======================================
    // BEVEL
    // ======================================
    //
    // Lógica: `width` es una distancia REAL en unidades del modelo (no una
    // fracción). Para cada vértice V tocado por aristas seleccionadas, en cada
    // cara F incidente se crea un vértice nuevo V_F = V + dirInterior * width,
    // donde `dirInterior` es el vector unitario que va desde V hacia dentro de
    // F (hacia el punto medio de los vecinos no-seleccionados de V en F).
    //
    // Con varias aristas compartiendo V (esquinas), V genera varios V_F, y el
    // n-gon de la esquina une los V_F que confluyen.
    //
    // El chaflán de una arista A-B se construye entre los pares (A_f1, B_f1) y
    // (A_f2, B_f2) de sus dos caras adyacentes, con `segments` anillos
    // interpolados y `depth` aplicado en la zona media a lo largo de la normal
    // promedio.

    bevelEdges(mesh, edgeIndices, width = 0.08, segments = 1, depth = 0) {
        if (!edgeIndices || edgeIndices.length === 0) return false;
        width = Math.max(0.001, Number(width) || 0.08);
        segments = Math.max(1, Math.min(8, Math.floor(segments)));
        depth = Number(depth) || 0;

        const allEdges = this.edges(mesh);
        const edgeKeys = new Set();
        const selectedEdges = [];
        for (const ei of edgeIndices) {
            const e = allEdges[ei];
            if (!e) continue;
            const key = e[0] < e[1] ? `${e[0]}_${e[1]}` : `${e[1]}_${e[0]}`;
            if (edgeKeys.has(key)) continue;
            edgeKeys.add(key);
            selectedEdges.push([e[0], e[1]]);
        }
        if (selectedEdges.length === 0) return false;

        // 1) Topología por vértice
        const vertexFaces = new Map();
        for (let fi = 0; fi < mesh.faces.length; fi++) {
            for (const vi of mesh.faces[fi]) {
                if (!vertexFaces.has(vi)) vertexFaces.set(vi, new Set());
                vertexFaces.get(vi).add(fi);
            }
        }

        const vertexSelEdges = new Map();
        for (const [a, b] of selectedEdges) {
            if (!vertexSelEdges.has(a)) vertexSelEdges.set(a, []);
            if (!vertexSelEdges.has(b)) vertexSelEdges.set(b, []);
            vertexSelEdges.get(a).push({ other: b });
            vertexSelEdges.get(b).push({ other: a });
        }

        const VA = mesh.vertices;

        // newVert[vid].get(fi) = índice del vértice desplazado
        const newVert = new Map();
        for (const [vid, sels] of vertexSelEdges) {
            const incidentFaces = vertexFaces.get(vid) || new Set();
            newVert.set(vid, new Map());
            const V = VA[vid];
            const selOthers = new Set(sels.map(s => s.other));

            for (const fi of incidentFaces) {
                const f = mesh.faces[fi];
                const n = f.length;
                let k = -1;
                for (let j = 0; j < n; j++) if (f[j] === vid) { k = j; break; }
                if (k < 0) continue;

                const prev = f[(k - 1 + n) % n];
                const next = f[(k + 1) % n];

                // Vecinos no-seleccionados de V en esta cara
                const candidates = [];
                if (!selOthers.has(prev)) candidates.push(prev);
                if (!selOthers.has(next)) candidates.push(next);

                let target;
                if (candidates.length === 2) {
                    const P1 = VA[candidates[0]], P2 = VA[candidates[1]];
                    target = [
                        (P1[0] + P2[0]) / 2,
                        (P1[1] + P2[1]) / 2,
                        (P1[2] + P2[2]) / 2
                    ];
                } else if (candidates.length === 1) {
                    target = [...VA[candidates[0]]];
                } else {
                    target = this.faceCenter(mesh, fi);
                }

                let dx = target[0] - V[0];
                let dy = target[1] - V[1];
                let dz = target[2] - V[2];
                const dL = Math.hypot(dx, dy, dz) || 1;
                dx /= dL; dy /= dL; dz /= dL;

                // Distancia real `width` (no fracción)
                const idx = VA.length;
                VA.push([
                    V[0] + dx * width,
                    V[1] + dy * width,
                    V[2] + dz * width
                ]);
                newVert.get(vid).set(fi, idx);
            }
        }

        // 2) Sustituir la arista A-B en cada cara adyacente por los desplazados
        for (const [a, b] of selectedEdges) {
            const facesOfEdge = [];
            for (let fi = 0; fi < mesh.faces.length; fi++) {
                const f = mesh.faces[fi];
                const n = f.length;
                for (let i = 0; i < n; i++) {
                    const u = f[i], w = f[(i + 1) % n];
                    if ((u === a && w === b) || (u === b && w === a)) {
                        facesOfEdge.push(fi);
                        break;
                    }
                }
            }
            for (const fi of facesOfEdge) {
                const f = mesh.faces[fi];
                const n = f.length;
                const nA = newVert.get(a)?.get(fi);
                const nB = newVert.get(b)?.get(fi);
                if (nA === undefined || nB === undefined) continue;
                for (let i = 0; i < n; i++) {
                    const u = f[i], w = f[(i + 1) % n];
                    if (u === a && w === b) { f[i] = nA; f[(i + 1) % n] = nB; break; }
                    if (u === b && w === a) { f[i] = nB; f[(i + 1) % n] = nA; break; }
                }
            }
        }

        // 3) Chaflán por arista
        const edgeCornerInfo = new Map();
        for (const [a, b] of selectedEdges) {
            const facesOfEdge = [];
            for (let fi = 0; fi < mesh.faces.length; fi++) {
                const f = mesh.faces[fi];
                const n = f.length;
                for (let i = 0; i < n; i++) {
                    const u = f[i], w = f[(i + 1) % n];
                    if ((u === a && w === b) || (u === b && w === a)) {
                        facesOfEdge.push(fi);
                        break;
                    }
                }
            }
            if (facesOfEdge.length !== 2) continue;
            const [f1, f2] = facesOfEdge;

            const nA1 = newVert.get(a).get(f1);
            const nA2 = newVert.get(a).get(f2);
            const nB1 = newVert.get(b).get(f1);
            const nB2 = newVert.get(b).get(f2);

            const normal1 = this.faceNormal(mesh, f1);
            const normal2 = this.faceNormal(mesh, f2);
            const avgN = [
                (normal1[0] + normal2[0]) / 2,
                (normal1[1] + normal2[1]) / 2,
                (normal1[2] + normal2[2]) / 2
            ];
            const nLen = Math.hypot(avgN[0], avgN[1], avgN[2]) || 1;
            const depthDir = [avgN[0] / nLen, avgN[1] / nLen, avgN[2] / nLen];

            const rowA = [], rowB = [];
            for (let r = 0; r <= segments; r++) {
                if (r === 0) {
                    rowA.push(nA1); rowB.push(nB1);
                } else if (r === segments) {
                    rowA.push(nA2); rowB.push(nB2);
                } else {
                    const t = r / segments;
                    const PA0 = VA[nA1], PA1 = VA[nA2];
                    const PB0 = VA[nB1], PB1 = VA[nB2];
                    const depthFactor = depth * (0.5 - Math.abs(t - 0.5)) * 2;
                    const ia = VA.length;
                    VA.push([
                        PA0[0] + (PA1[0] - PA0[0]) * t + depthDir[0] * depthFactor,
                        PA0[1] + (PA1[1] - PA0[1]) * t + depthDir[1] * depthFactor,
                        PA0[2] + (PA1[2] - PA0[2]) * t + depthDir[2] * depthFactor
                    ]);
                    const ib = VA.length;
                    VA.push([
                        PB0[0] + (PB1[0] - PB0[0]) * t + depthDir[0] * depthFactor,
                        PB0[1] + (PB1[1] - PB0[1]) * t + depthDir[1] * depthFactor,
                        PB0[2] + (PB1[2] - PB0[2]) * t + depthDir[2] * depthFactor
                    ]);
                    rowA.push(ia);
                    rowB.push(ib);
                }
            }

            for (let r = 0; r < segments; r++) {
                mesh.faces.push([rowA[r], rowB[r], rowB[r + 1], rowA[r + 1]]);
            }

            // Registrar esquinas
            for (const [v, nV1, nV2, other] of [[a, nA1, nA2, b], [b, nB1, nB2, a]]) {
                if (!edgeCornerInfo.has(v)) edgeCornerInfo.set(v, []);
                edgeCornerInfo.get(v).push({
                    fi1: f1, fi2: f2,
                    nV_f1: nV1, nV_f2: nV2,
                    other
                });
            }
        }

        // 4) Esquinas: n-gon por vértice con ≥2 aristas
        for (const [vid, entries] of edgeCornerInfo) {
            if (entries.length < 2) continue;
            const incidentFacesSet = new Set();
            for (const e of entries) {
                incidentFacesSet.add(e.fi1);
                incidentFacesSet.add(e.fi2);
            }
            const faceRing = this._vertexFaceRing(mesh, vid, incidentFacesSet);
            if (!faceRing || faceRing.length < 2) continue;
            const cornerVerts = [];
            for (const fi of faceRing) {
                const idx = newVert.get(vid).get(fi);
                if (idx !== undefined) cornerVerts.push(idx);
            }
            if (cornerVerts.length >= 3) {
                mesh.faces.push(cornerVerts.slice());
            }
        }

        this.fixWindingByComponent(mesh);
        this.compactMesh(mesh);
        return true;
    },

    _vertexFaceRing(mesh, vid, allowed) {
        const incident = [];
        for (let fi = 0; fi < mesh.faces.length; fi++) {
            if (!allowed.has(fi)) continue;
            const f = mesh.faces[fi];
            const n = f.length;
            for (let i = 0; i < n; i++) {
                if (f[i] === vid) { incident.push(fi); break; }
            }
        }
        if (incident.length < 2) return null;

        const edgeToFaces = new Map();
        for (const fi of incident) {
            const f = mesh.faces[fi];
            const n = f.length;
            let k = -1;
            for (let i = 0; i < n; i++) if (f[i] === vid) { k = i; break; }
            if (k < 0) continue;
            const prev = f[(k - 1 + n) % n];
            const next = f[(k + 1) % n];
            const kPrev = vid < prev ? `${vid}_${prev}` : `${prev}_${vid}`;
            const kNext = vid < next ? `${vid}_${next}` : `${next}_${vid}`;
            if (!edgeToFaces.has(kPrev)) edgeToFaces.set(kPrev, []);
            if (!edgeToFaces.has(kNext)) edgeToFaces.set(kNext, []);
            edgeToFaces.get(kPrev).push(fi);
            edgeToFaces.get(kNext).push(fi);
        }

        const startFace = incident[0];
        const ordered = [startFace];
        const used = new Set([startFace]);
        let cur = startFace;
        for (let steps = 0; steps < incident.length * 2; steps++) {
            const f = mesh.faces[cur];
            const n = f.length;
            let k = -1;
            for (let i = 0; i < n; i++) if (f[i] === vid) { k = i; break; }
            const nextV = f[(k + 1) % n];
            const kNext = vid < nextV ? `${vid}_${nextV}` : `${nextV}_${vid}`;
            const candidates = (edgeToFaces.get(kNext) || []).filter(fi => !used.has(fi) && allowed.has(fi));
            if (candidates.length === 0) break;
            const nf = candidates[0];
            ordered.push(nf);
            used.add(nf);
            cur = nf;
        }

        if (used.size < incident.length) {
            const startFacePrev = incident[0];
            const prevOrder = [];
            let cur2 = startFacePrev;
            const used2 = new Set([startFacePrev]);
            for (let steps = 0; steps < incident.length * 2; steps++) {
                const f = mesh.faces[cur2];
                const n = f.length;
                let k = -1;
                for (let i = 0; i < n; i++) if (f[i] === vid) { k = i; break; }
                const prevV = f[(k - 1 + n) % n];
                const kPrev = vid < prevV ? `${vid}_${prevV}` : `${prevV}_${vid}`;
                const candidates = (edgeToFaces.get(kPrev) || []).filter(fi => !used2.has(fi) && allowed.has(fi));
                if (candidates.length === 0) break;
                const nf = candidates[0];
                prevOrder.push(nf);
                used2.add(nf);
                cur2 = nf;
            }
            const merged = prevOrder.reverse().concat(ordered);
            if (merged.length === incident.length) return merged;
        }

        return ordered;
    },

    bevelEdge(mesh, edgeIndex, width = 0.08, segments = 1, depth = 0) {
        return this.bevelEdges(mesh, [edgeIndex], width, segments, depth);
    },

    bevelFace(mesh, faceIndex, width = 0.08, segments = 1) {
        const face = mesh.faces[faceIndex];
        if (!face) return false;
        const n = face.length;
        if (n < 3) return false;
        width = Math.max(0.001, Number(width) || 0.08);

        const P = mesh.vertices;
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < n; i++) {
            const v = P[face[i]];
            cx += v[0]; cy += v[1]; cz += v[2];
        }
        cx /= n; cy /= n; cz /= n;

        const inner = [];
        for (let i = 0; i < n; i++) {
            const v = P[face[i]];
            let dx = cx - v[0], dy = cy - v[1], dz = cz - v[2];
            const L = Math.hypot(dx, dy, dz) || 1;
            dx /= L; dy /= L; dz /= L;
            // `width` como distancia real, limitada por la mitad del radio
            const dist = Math.min(width, L * 0.49);
            const idx = P.length;
            P.push([v[0] + dx * dist, v[1] + dy * dist, v[2] + dz * dist]);
            inner.push(idx);
        }

        mesh.faces[faceIndex] = inner.slice();
        for (let i = 0; i < n; i++) {
            const a = face[i];
            const b = face[(i + 1) % n];
            const ai = inner[i];
            const bi = inner[(i + 1) % n];
            mesh.faces.push([a, b, bi, ai]);
        }

        mesh.version++;
        this.fixWindingByComponent(mesh);
        return true;
    },

    flipFaces(mesh, faceIndices) {
        if (!faceIndices || faceIndices.length === 0) return false;
        let count = 0;
        for (const fi of faceIndices) {
            const f = mesh.faces[fi];
            if (!f) continue;
            mesh.faces[fi] = f.slice().reverse();
            count++;
        }
        if (count > 0) mesh.version++;
        return count > 0;
    },

    applySubdivision(mesh, levels = 1) {
        levels = Math.max(1, Math.min(3, Math.floor(levels)));
        const sub = catmullClarkSubdivide(mesh, levels);
        mesh.vertices = sub.vertices.map(v => [v[0], v[1], v[2]]);
        mesh.faces = sub.faces.map(f => f.slice());
        mesh.edgeMidpoints = new Map();
        mesh.version++;
        return true;
    }

};