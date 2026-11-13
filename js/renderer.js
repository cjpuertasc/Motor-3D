// ==========================================
// MODEL LAB - RENDER ENGINE
// ==========================================

class Renderer3D {

    constructor(canvas) {

        this.canvas = canvas;

        this.gl = canvas.getContext("webgl2", {
            antialias: true,
            alpha: false
        });

        if (!this.gl) {
            throw new Error("WebGL 2 no está disponible en este navegador.");
        }

        const gl = this.gl;

        // ---- SHADER DE OBJETOS ----
        const vertexShader = `#version 300 es
        in vec3 aPosition;
        in vec3 aNormal;
        uniform mat4 uMVP;
        uniform mat4 uModel;
        out vec3 vNormal;
        void main() {
            gl_Position = uMVP * vec4(aPosition, 1.0);
            vNormal = mat3(uModel) * aNormal;
        }
        `;

        const fragmentShader = `#version 300 es
        precision highp float;
        in vec3 vNormal;
        uniform vec3 uColor;
        uniform float uSelected;
        out vec4 outColor;
        void main() {
            vec3 normal = normalize(vNormal);
            vec3 lightDirection = normalize(vec3(-0.4, 0.8, 0.6));
            float diffuse = max(dot(normal, lightDirection), 0.0);
            float lighting = 0.35 + diffuse * 0.65;
            vec3 color = uColor * lighting;
            if (uSelected > 0.5) {
                color = mix(color, vec3(0.65, 0.55, 1.0), 0.15);
            }
            outColor = vec4(color, 1.0);
        }
        `;

        this.program = this.createProgram(vertexShader, fragmentShader);

        this.locations = {
            position: gl.getAttribLocation(this.program, "aPosition"),
            normal:   gl.getAttribLocation(this.program, "aNormal"),
            mvp:      gl.getUniformLocation(this.program, "uMVP"),
            model:    gl.getUniformLocation(this.program, "uModel"),
            color:    gl.getUniformLocation(this.program, "uColor"),
            selected: gl.getUniformLocation(this.program, "uSelected")
        };

        // ---- SHADER DE LÍNEAS ----
        const lineVertex = `#version 300 es
        in vec3 aPosition;
        uniform mat4 uMVP;
        void main() { gl_Position = uMVP * vec4(aPosition, 1.0); }
        `;
        const lineFragment = `#version 300 es
        precision mediump float;
        uniform vec4 uColor;
        out vec4 outColor;
        void main() { outColor = uColor; }
        `;

        this.gridProgram = this.createProgram(lineVertex, lineFragment);
        this.gridLocations = {
            position: gl.getAttribLocation(this.gridProgram, "aPosition"),
            mvp:      gl.getUniformLocation(this.gridProgram, "uMVP"),
            color:    gl.getUniformLocation(this.gridProgram, "uColor")
        };

        this.gridBuffer = this.createGrid();

        // ---- SHADER PLANO ----
        const flatVertex = `#version 300 es
        in vec3 aPosition;
        uniform mat4 uMVP;
        uniform float uPointSize;
        void main() {
            gl_Position = uMVP * vec4(aPosition, 1.0);
            gl_PointSize = uPointSize;
        }
        `;
        const flatFragment = `#version 300 es
        precision mediump float;
        uniform vec4 uColor;
        out vec4 outColor;
        void main() { outColor = uColor; }
        `;

        this.flatProgram = this.createProgram(flatVertex, flatFragment);
        this.flatLocations = {
            position:  gl.getAttribLocation(this.flatProgram, "aPosition"),
            mvp:       gl.getUniformLocation(this.flatProgram, "uMVP"),
            color:     gl.getUniformLocation(this.flatProgram, "uColor"),
            pointSize: gl.getUniformLocation(this.flatProgram, "uPointSize")
        };

        // ---- SHADER DE GIZMO ----
        const gizmoVertex = `#version 300 es
        in vec3 aPosition;
        in vec4 aColor;
        in float aAxis;
        uniform mat4 uViewProjection;
        uniform vec3 uPivotWorld;
        uniform vec3 uCameraPos;
        uniform float uFovTanHalf;
        uniform float uPixelSize;
        uniform float uScreenHeight;
        uniform int uMode;
        uniform int uVisibleShape;
        out vec4 vColor;
        flat out float vAxis;
        out float vVisible;
        void main() {
            float distance = length(uCameraPos - uPivotWorld);
            distance = max(distance, 0.001);
            float worldSize = 2.0 * distance * uFovTanHalf * (uPixelSize / uScreenHeight);
            vVisible = (uMode == uVisibleShape) ? 1.0 : 0.0;
            vec3 worldPos = uPivotWorld + aPosition * worldSize;
            gl_Position = uViewProjection * vec4(worldPos, 1.0);
            vColor = aColor;
            vAxis = aAxis;
        }
        `;

        const gizmoFragment = `#version 300 es
        precision highp float;
        in vec4 vColor;
        flat in float vAxis;
        in float vVisible;
        uniform int uPickingPass;
        uniform int uActiveAxis;
        uniform float uHasActiveAxis;
        out vec4 outColor;
        void main() {
            if (vVisible < 0.5) discard;
            if (uPickingPass == 1) {
                float a = vAxis;
                vec3 pickColor = vec3(0.0);
                if (a < 0.5)      pickColor = vec3(1.0, 0.0, 0.0);
                else if (a < 1.5) pickColor = vec3(0.0, 1.0, 0.0);
                else if (a < 2.5) pickColor = vec3(0.0, 0.0, 1.0);
                else              pickColor = vec3(1.0, 1.0, 1.0);
                outColor = vec4(pickColor, 1.0);
                return;
            }
            vec3 base = vColor.rgb;
            float alpha = vColor.a;
            if (uHasActiveAxis > 0.5) {
                bool isActive = abs(vAxis - float(uActiveAxis)) < 0.5;
                if (isActive) base = mix(base, vec3(1.0), 0.20);
                else base *= 0.25;
            }
            outColor = vec4(base, alpha);
        }
        `;

        this.gizmoProgram = this.createProgram(gizmoVertex, gizmoFragment);
        this.gizmoLocations = {
            position:       gl.getAttribLocation(this.gizmoProgram, "aPosition"),
            color:          gl.getAttribLocation(this.gizmoProgram, "aColor"),
            axis:           gl.getAttribLocation(this.gizmoProgram, "aAxis"),
            viewProjection: gl.getUniformLocation(this.gizmoProgram, "uViewProjection"),
            pivotWorld:     gl.getUniformLocation(this.gizmoProgram, "uPivotWorld"),
            cameraPos:      gl.getUniformLocation(this.gizmoProgram, "uCameraPos"),
            fovTanHalf:     gl.getUniformLocation(this.gizmoProgram, "uFovTanHalf"),
            pixelSize:      gl.getUniformLocation(this.gizmoProgram, "uPixelSize"),
            screenHeight:   gl.getUniformLocation(this.gizmoProgram, "uScreenHeight"),
            mode:           gl.getUniformLocation(this.gizmoProgram, "uMode"),
            visibleShape:   gl.getUniformLocation(this.gizmoProgram, "uVisibleShape"),
            pickingPass:    gl.getUniformLocation(this.gizmoProgram, "uPickingPass"),
            activeAxis:     gl.getUniformLocation(this.gizmoProgram, "uActiveAxis"),
            hasActiveAxis:  gl.getUniformLocation(this.gizmoProgram, "uHasActiveAxis")
        };

        this.gizmoGeometry = this.createGizmoGeometry();

        this.pickFbo = null;
        this.pickColorTex = null;
        this.pickDepth = null;
        this.pickSize = { w: 0, h: 0 };

        this.meshBuffersFaceted = new Map();
        this.meshBuffersSmooth  = new Map();
        this.wireframeBuffers   = new Map();

        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0.085, 0.095, 0.115, 1);
    }


    createProgram(vertexSource, fragmentSource) {
        const gl = this.gl;
        function compile(type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                throw new Error(gl.getShaderInfoLog(shader));
            }
            return shader;
        }
        const v = compile(gl.VERTEX_SHADER, vertexSource);
        const f = compile(gl.FRAGMENT_SHADER, fragmentSource);
        const program = gl.createProgram();
        gl.attachShader(program, v);
        gl.attachShader(program, f);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program));
        }
        return program;
    }

    createGrid() {
        const vertices = [];
        for (let i = -20; i <= 20; i++) {
            vertices.push(i, 0, -20, i, 0, 20, -20, 0, i, 20, 0, i);
        }
        const gl = this.gl;
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        return { buffer, count: vertices.length / 3 };
    }

    createGizmoGeometry() {
        const gl = this.gl;
        const data = [];
        const RED = [1, 0.35, 0.35, 1];
        const GREEN = [0.40, 0.85, 0.55, 1];
        const BLUE = [0.40, 0.65, 1.0, 1];
        const WHITE = [1, 1, 1, 1];

        function pushVertex(pos, color, axis) {
            data.push(pos[0], pos[1], pos[2], color[0], color[1], color[2], color[3], axis);
        }
        function quad(p0, p1, p2, p3, color, axis) {
            pushVertex(p0, color, axis); pushVertex(p1, color, axis); pushVertex(p2, color, axis);
            pushVertex(p0, color, axis); pushVertex(p2, color, axis); pushVertex(p3, color, axis);
        }
        function makeArrow(axisIndex, color) {
            const L = 0.75, W = 0.03, HW = 0.09, HL = 0.18;
            const base = L - HL;
            let u, v, w;
            if (axisIndex === 0) { u = [1,0,0]; v = [0,1,0]; w = [0,0,1]; }
            else if (axisIndex === 1) { u = [0,1,0]; v = [1,0,0]; w = [0,0,1]; }
            else { u = [0,0,1]; v = [1,0,0]; w = [0,1,0]; }
            function pt(a, b, c) {
                return [
                    u[0]*a + v[0]*b + w[0]*c,
                    u[1]*a + v[1]*b + w[1]*c,
                    u[2]*a + v[2]*b + w[2]*c
                ];
            }
            quad(pt(0,-W,0), pt(0,W,0), pt(base,W,0), pt(base,-W,0), color, axisIndex);
            quad(pt(0,0,-W), pt(0,0,W), pt(base,0,W), pt(base,0,-W), color, axisIndex);
            pushVertex(pt(base, -HW, 0), color, axisIndex);
            pushVertex(pt(base,  HW, 0), color, axisIndex);
            pushVertex(pt(L, 0, 0), color, axisIndex);
            pushVertex(pt(base, 0, -HW), color, axisIndex);
            pushVertex(pt(base, 0,  HW), color, axisIndex);
            pushVertex(pt(L, 0, 0), color, axisIndex);
        }
        makeArrow(0, RED);
        makeArrow(1, GREEN);
        makeArrow(2, BLUE);

        const cube = 0.10;
        for (const f of [
            [[-cube,-cube, cube],[ cube,-cube, cube],[ cube, cube, cube],[-cube, cube, cube]],
            [[ cube,-cube,-cube],[-cube,-cube,-cube],[-cube, cube,-cube],[ cube, cube,-cube]],
            [[ cube,-cube, cube],[ cube,-cube,-cube],[ cube, cube,-cube],[ cube, cube, cube]],
            [[-cube,-cube,-cube],[-cube,-cube, cube],[-cube, cube, cube],[-cube, cube,-cube]],
            [[-cube, cube, cube],[ cube, cube, cube],[ cube, cube,-cube],[-cube, cube,-cube]],
            [[-cube,-cube,-cube],[ cube,-cube,-cube],[ cube,-cube, cube],[-cube,-cube, cube]]
        ]) quad(f[0], f[1], f[2], f[3], WHITE, 3);

        const moveTriCount = data.length / 8 / 3;

        function makeRing(axisIndex, color, radius, thickness) {
            const SEG = 64;
            function center(r, theta) {
                if (axisIndex === 0) return [0, r * Math.cos(theta), r * Math.sin(theta)];
                if (axisIndex === 1) return [r * Math.cos(theta), 0, r * Math.sin(theta)];
                return [r * Math.cos(theta), r * Math.sin(theta), 0];
            }
            for (let i = 0; i < SEG; i++) {
                const t0 = i / SEG * Math.PI * 2;
                const t1 = (i + 1) / SEG * Math.PI * 2;
                const a0 = center(radius - thickness, t0);
                const a1 = center(radius + thickness, t0);
                const b0 = center(radius - thickness, t1);
                const b1 = center(radius + thickness, t1);
                pushVertex(a0, color, axisIndex); pushVertex(a1, color, axisIndex); pushVertex(b1, color, axisIndex);
                pushVertex(a0, color, axisIndex); pushVertex(b1, color, axisIndex); pushVertex(b0, color, axisIndex);
            }
        }
        makeRing(0, RED,   0.62, 0.018);
        makeRing(1, GREEN, 0.62, 0.018);
        makeRing(2, BLUE,  0.62, 0.018);
        makeRing(3, WHITE, 0.78, 0.014);

        const rotateTriCount = data.length / 8 / 3 - moveTriCount;

        function makeScaleAxis(axisIndex, color) {
            const L = 0.75, W = 0.025;
            let u, v, w;
            if (axisIndex === 0) { u = [1,0,0]; v = [0,1,0]; w = [0,0,1]; }
            else if (axisIndex === 1) { u = [0,1,0]; v = [1,0,0]; w = [0,0,1]; }
            else { u = [0,0,1]; v = [1,0,0]; w = [0,1,0]; }
            function pt(a, b, c) {
                return [
                    u[0]*a + v[0]*b + w[0]*c,
                    u[1]*a + v[1]*b + w[1]*c,
                    u[2]*a + v[2]*b + w[2]*c
                ];
            }
            quad(pt(0,-W,0), pt(0,W,0), pt(L,W,0), pt(L,-W,0), color, axisIndex);
            quad(pt(0,0,-W), pt(0,0,W), pt(L,0,W), pt(L,0,-W), color, axisIndex);
            const s = 0.07;
            quad(pt(L-s,-s,0), pt(L-s,s,0), pt(L+s,s,0), pt(L+s,-s,0), color, axisIndex);
            quad(pt(L-s,0,-s), pt(L-s,0,s), pt(L+s,0,s), pt(L+s,0,-s), color, axisIndex);
        }
        makeScaleAxis(0, RED);
        makeScaleAxis(1, GREEN);
        makeScaleAxis(2, BLUE);

        const sc = 0.11;
        for (const f of [
            [[-sc,-sc, sc],[ sc,-sc, sc],[ sc, sc, sc],[-sc, sc, sc]],
            [[ sc,-sc,-sc],[-sc,-sc,-sc],[-sc, sc,-sc],[ sc, sc,-sc]],
            [[ sc,-sc, sc],[ sc,-sc,-sc],[ sc, sc,-sc],[ sc, sc, sc]],
            [[-sc,-sc,-sc],[-sc,-sc, sc],[-sc, sc, sc],[-sc, sc,-sc]],
            [[-sc, sc, sc],[ sc, sc, sc],[ sc, sc,-sc],[-sc, sc,-sc]],
            [[-sc,-sc,-sc],[ sc,-sc,-sc],[ sc,-sc, sc],[-sc,-sc, sc]]
        ]) quad(f[0], f[1], f[2], f[3], WHITE, 3);

        const scaleTriCount = data.length / 8 / 3 - moveTriCount - rotateTriCount;

        const dataArr = new Float32Array(data);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, dataArr, gl.STATIC_DRAW);

        return {
            buffer,
            moveFirst: 0,
            moveCount: moveTriCount * 3,
            rotateFirst: moveTriCount * 3,
            rotateCount: rotateTriCount * 3,
            scaleFirst: (moveTriCount + rotateTriCount) * 3,
            scaleCount: scaleTriCount * 3
        };
    }

    invalidateMesh(mesh) {
        this.meshBuffersFaceted.delete(mesh);
        this.meshBuffersSmooth.delete(mesh);
        this.wireframeBuffers.delete(mesh);
    }

    pruneMeshCache(activeObjects) {
        const active = new Set(activeObjects.map(o => o.mesh));
        const gl = this.gl;
        function freeBuffers(map) {
            for (const [mesh, buf] of map) {
                if (!active.has(mesh)) {
                    if (buf.position) gl.deleteBuffer(buf.position);
                    if (buf.normal)   gl.deleteBuffer(buf.normal);
                    if (buf.indices)  gl.deleteBuffer(buf.indices);
                    if (buf.edges)    gl.deleteBuffer(buf.edges);
                    if (buf.points)   gl.deleteBuffer(buf.points);
                    map.delete(mesh);
                }
            }
        }
        freeBuffers(this.meshBuffersFaceted);
        freeBuffers(this.meshBuffersSmooth);
        freeBuffers(this.wireframeBuffers);
    }

    getMeshBuffers(mesh, smooth, level) {
        const cache = smooth ? this.meshBuffersSmooth : this.meshBuffersFaceted;
        const cacheKey = smooth ? `${mesh.version}_${level}` : mesh.version;

        const cached = cache.get(mesh);
        if (cached && cached.cacheKey === cacheKey) return cached;

        if (cached) {
            const gl = this.gl;
            gl.deleteBuffer(cached.position);
            gl.deleteBuffer(cached.normal);
            gl.deleteBuffer(cached.indices);
        }

        const gl = this.gl;

        let data;
        if (smooth) {
            data = buildRenderDataSubdivided(mesh, level);
        } else {
            data = buildRenderData(mesh);
        }

        const buffers = { version: mesh.version, cacheKey };

        buffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);

        buffers.normal = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
        gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW);

        buffers.indices = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);

        buffers.count = data.indices.length;
        buffers.indexType = data.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        cache.set(mesh, buffers);
        return buffers;
    }

    getWireframeBuffers(mesh) {
        const cached = this.wireframeBuffers.get(mesh);
        if (cached && cached.version === mesh.version) return cached;

        if (cached) {
            const gl = this.gl;
            gl.deleteBuffer(cached.edges);
            gl.deleteBuffer(cached.points);
        }

        const gl = this.gl;
        const edges = computeEdges(mesh);
        const edgeVerts = [];
        for (const [a, b] of edges) {
            const va = mesh.vertices[a];
            const vb = mesh.vertices[b];
            edgeVerts.push(va[0], va[1], va[2], vb[0], vb[1], vb[2]);
        }
        const pointVerts = [];
        for (const v of mesh.vertices) pointVerts.push(v[0], v[1], v[2]);
        const edgeBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(edgeVerts), gl.STATIC_DRAW);
        const pointBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pointVerts), gl.STATIC_DRAW);
        const buffers = {
            version: mesh.version,
            edges: edgeBuf,
            edgeCount: edgeVerts.length / 3,
            points: pointBuf,
            pointCount: pointVerts.length / 3
        };
        this.wireframeBuffers.set(mesh, buffers);
        return buffers;
    }

    drawGrid(viewProjection) {
        const gl = this.gl;
        const l = this.gridLocations;
        gl.useProgram(this.gridProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer.buffer);
        gl.enableVertexAttribArray(l.position);
        gl.vertexAttribPointer(l.position, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(l.mvp, false, viewProjection);
        gl.uniform4fv(l.color, [0.30, 0.33, 0.39, 1]);
        gl.drawArrays(gl.LINES, 0, this.gridBuffer.count);
    }

    drawFlatTriangles(positions, mvp, color) {
        const gl = this.gl;
        const l = this.flatLocations;
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
        gl.useProgram(this.flatProgram);
        gl.enableVertexAttribArray(l.position);
        gl.vertexAttribPointer(l.position, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(l.mvp, false, mvp);
        gl.uniform4fv(l.color, color);
        gl.uniform1f(l.pointSize, 1.0);
        gl.drawArrays(gl.TRIANGLES, 0, positions.length / 3);
        gl.deleteBuffer(buffer);
    }

    drawFlatLines(positions, mvp, color) {
        const gl = this.gl;
        const l = this.flatLocations;
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
        gl.useProgram(this.flatProgram);
        gl.enableVertexAttribArray(l.position);
        gl.vertexAttribPointer(l.position, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(l.mvp, false, mvp);
        gl.uniform4fv(l.color, color);
        gl.uniform1f(l.pointSize, 1.0);
        gl.drawArrays(gl.LINES, 0, positions.length / 3);
        gl.deleteBuffer(buffer);
    }

    drawFlatPoint(position, mvp, color, size) {
        const gl = this.gl;
        const l = this.flatLocations;
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(position), gl.STATIC_DRAW);
        gl.useProgram(this.flatProgram);
        gl.enableVertexAttribArray(l.position);
        gl.vertexAttribPointer(l.position, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(l.mvp, false, mvp);
        gl.uniform4fv(l.color, color);
        gl.uniform1f(l.pointSize, size);
        gl.drawArrays(gl.POINTS, 0, 1);
        gl.deleteBuffer(buffer);
    }

    pivotWorld(object) {
        const model = Matrix4.compose(object.position, object.rotation, object.scale, object.pivot);
        const p = object.pivot || [0, 0, 0];
        return [
            model[0] * p[0] + model[4] * p[1] + model[8]  * p[2] + model[12],
            model[1] * p[0] + model[5] * p[1] + model[9]  * p[2] + model[13],
            model[2] * p[0] + model[6] * p[1] + model[10] * p[2] + model[14]
        ];
    }

    drawGizmoAt(worldPivot, camera, viewProjection, pixelHeight, gizmoMode, activeAxis, pixelSize, hoverAxis) {
        if (!gizmoMode) return;
        const gl = this.gl;
        const l = this.gizmoLocations;
        const geom = this.gizmoGeometry;
        const fovTanHalf = Math.tan(55 * Math.PI / 180 / 2);

        gl.useProgram(this.gizmoProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, geom.buffer);
        gl.enableVertexAttribArray(l.position);
        gl.vertexAttribPointer(l.position, 3, gl.FLOAT, false, 8 * 4, 0);
        gl.enableVertexAttribArray(l.color);
        gl.vertexAttribPointer(l.color, 4, gl.FLOAT, false, 8 * 4, 3 * 4);
        gl.enableVertexAttribArray(l.axis);
        gl.vertexAttribPointer(l.axis, 1, gl.FLOAT, false, 8 * 4, 7 * 4);

        gl.uniformMatrix4fv(l.viewProjection, false, viewProjection);
        gl.uniform3fv(l.pivotWorld, worldPivot);
        gl.uniform3fv(l.cameraPos, camera.position);
        gl.uniform1f(l.fovTanHalf, fovTanHalf);
        gl.uniform1f(l.pixelSize, pixelSize || 99);
        gl.uniform1f(l.screenHeight, pixelHeight);
        gl.uniform1i(l.pickingPass, 0);

        let hlAxis = activeAxis;
        let hasHl = (activeAxis !== null && activeAxis !== undefined);
        if (!hasHl && hoverAxis !== undefined && hoverAxis !== null) {
            hlAxis = hoverAxis;
            hasHl = true;
        }
        gl.uniform1i(l.activeAxis, hasHl ? hlAxis : -1);
        gl.uniform1f(l.hasActiveAxis, hasHl ? 1 : 0);

        gl.disable(gl.DEPTH_TEST);

        if (gizmoMode === "move") {
            gl.uniform1i(l.mode, 0);
            gl.uniform1i(l.visibleShape, 0);
            gl.drawArrays(gl.TRIANGLES, geom.moveFirst, geom.moveCount);
        } else if (gizmoMode === "rotate") {
            gl.uniform1i(l.mode, 1);
            gl.uniform1i(l.visibleShape, 1);
            gl.drawArrays(gl.TRIANGLES, geom.rotateFirst, geom.rotateCount);
        } else if (gizmoMode === "scale") {
            gl.uniform1i(l.mode, 2);
            gl.uniform1i(l.visibleShape, 2);
            gl.drawArrays(gl.TRIANGLES, geom.scaleFirst, geom.scaleCount);
        }

        gl.enable(gl.DEPTH_TEST);
    }

    pickGizmoAt(worldPivot, camera, clientX, clientY, gizmoMode, pixelSize) {
        if (!gizmoMode) return null;

        const gl = this.gl;
        const rect = this.canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const fw = Math.max(1, Math.floor(rect.width * dpr));
        const fh = Math.max(1, Math.floor(rect.height * dpr));

        this.ensurePickFbo(fw, fh);

        const px = Math.floor(((clientX - rect.left) / rect.width) * fw);
        const py = Math.floor((1 - (clientY - rect.top) / rect.height) * fh);
        if (px < 0 || px >= fw || py < 0 || py >= fh) return null;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
        gl.viewport(0, 0, fw, fh);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const projection = Matrix4.perspective(55 * Math.PI / 180, fw / fh, 0.1, 1000);
        const view = Matrix4.lookAt(camera.position, camera.target, [0, 1, 0]);
        const viewProjection = Matrix4.multiply(projection, view);

        const l = this.gizmoLocations;
        const geom = this.gizmoGeometry;
        const fovTanHalf = Math.tan(55 * Math.PI / 180 / 2);

        gl.useProgram(this.gizmoProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, geom.buffer);
        gl.enableVertexAttribArray(l.position);
        gl.vertexAttribPointer(l.position, 3, gl.FLOAT, false, 8 * 4, 0);
        gl.enableVertexAttribArray(l.color);
        gl.vertexAttribPointer(l.color, 4, gl.FLOAT, false, 8 * 4, 3 * 4);
        gl.enableVertexAttribArray(l.axis);
        gl.vertexAttribPointer(l.axis, 1, gl.FLOAT, false, 8 * 4, 7 * 4);

        gl.uniformMatrix4fv(l.viewProjection, false, viewProjection);
        gl.uniform3fv(l.pivotWorld, worldPivot);
        gl.uniform3fv(l.cameraPos, camera.position);
        gl.uniform1f(l.fovTanHalf, fovTanHalf);
        gl.uniform1f(l.pixelSize, pixelSize || 99);
        gl.uniform1f(l.screenHeight, fh);
        gl.uniform1i(l.pickingPass, 1);
        gl.uniform1i(l.activeAxis, -1);
        gl.uniform1f(l.hasActiveAxis, 0);

        gl.disable(gl.DEPTH_TEST);

        if (gizmoMode === "move") {
            gl.uniform1i(l.mode, 0);
            gl.uniform1i(l.visibleShape, 0);
            gl.drawArrays(gl.TRIANGLES, geom.moveFirst, geom.moveCount);
        } else if (gizmoMode === "rotate") {
            gl.uniform1i(l.mode, 1);
            gl.uniform1i(l.visibleShape, 1);
            gl.drawArrays(gl.TRIANGLES, geom.rotateFirst, geom.rotateCount);
        } else if (gizmoMode === "scale") {
            gl.uniform1i(l.mode, 2);
            gl.uniform1i(l.visibleShape, 2);
            gl.drawArrays(gl.TRIANGLES, geom.scaleFirst, geom.scaleCount);
        }

        gl.enable(gl.DEPTH_TEST);

        // Ventana 7x7 para ampliar el hitbox del eje
        const WIN = 3;
        const x0 = Math.max(0, px - WIN);
        const y0 = Math.max(0, py - WIN);
        const ww = Math.min(fw - x0, WIN * 2 + 1);
        const wh = Math.min(fh - y0, WIN * 2 + 1);
        const buf = new Uint8Array(ww * wh * 4);
        gl.readPixels(x0, y0, ww, wh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0.085, 0.095, 0.115, 1);

        let cntR = 0, cntG = 0, cntB = 0, cntW = 0;
        for (let i = 0; i < ww * wh; i++) {
            const r = buf[i*4], g = buf[i*4+1], b = buf[i*4+2], a = buf[i*4+3];
            if (a === 0) continue;
            if (r > 200 && g < 60 && b < 60) cntR++;
            else if (g > 200 && r < 60 && b < 60) cntG++;
            else if (b > 200 && r < 60 && g < 60) cntB++;
            else if (r > 200 && g > 200 && b > 200) cntW++;
        }
        const MIN = 3;
        const best = Math.max(cntR, cntG, cntB, cntW);
        if (best < MIN) return null;
        if (best === cntR) return { axis: 0 };
        if (best === cntG) return { axis: 1 };
        if (best === cntB) return { axis: 2 };
        return { axis: null };
    }

    ensurePickFbo(w, h) {
        const gl = this.gl;
        if (this.pickFbo && this.pickSize.w === w && this.pickSize.h === h) return;
        if (this.pickFbo) {
            gl.deleteFramebuffer(this.pickFbo);
            gl.deleteTexture(this.pickColorTex);
            gl.deleteRenderbuffer(this.pickDepth);
        }
        this.pickColorTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.pickColorTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        this.pickDepth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
        this.pickFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickColorTex, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickDepth);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.pickSize = { w, h };
    }

    drawGizmo(object, camera, viewProjection, pixelWidth, pixelHeight, gizmoMode, activeAxis, hoverAxis) {
        this.drawGizmoAt(this.pivotWorld(object), camera, viewProjection, pixelHeight, gizmoMode, activeAxis, 99, hoverAxis);
    }

    pickGizmo(object, camera, clientX, clientY, gizmoMode) {
        return this.pickGizmoAt(this.pivotWorld(object), camera, clientX, clientY, gizmoMode, 99);
    }

    drawEditOverlay(object, editSelection, viewProjection, camera, pixelWidth, pixelHeight, currentTool, activeAxis, hoverAxis) {
        const gl = this.gl;
        const mesh = object.mesh;
        const model = Matrix4.compose(object.position, object.rotation, object.scale, object.pivot);
        const mvp = Matrix4.multiply(viewProjection, model);
        const wf = this.getWireframeBuffers(mesh);

        {
            const l = this.flatLocations;
            gl.useProgram(this.flatProgram);
            gl.bindBuffer(gl.ARRAY_BUFFER, wf.edges);
            gl.enableVertexAttribArray(l.position);
            gl.vertexAttribPointer(l.position, 3, gl.FLOAT, false, 0, 0);
            gl.uniformMatrix4fv(l.mvp, false, mvp);
            gl.uniform4fv(l.color, [0.55, 0.58, 0.68, 1.0]);
            gl.uniform1f(l.pointSize, 1.0);
            const prevDepth = gl.isEnabled(gl.DEPTH_TEST);
            gl.disable(gl.DEPTH_TEST);
            gl.drawArrays(gl.LINES, 0, wf.edgeCount);
            if (prevDepth) gl.enable(gl.DEPTH_TEST);
        }

        {
            const l = this.flatLocations;
            gl.useProgram(this.flatProgram);
            gl.bindBuffer(gl.ARRAY_BUFFER, wf.points);
            gl.enableVertexAttribArray(l.position);
            gl.vertexAttribPointer(l.position, 3, gl.FLOAT, false, 0, 0);
            gl.uniformMatrix4fv(l.mvp, false, mvp);
            gl.uniform4fv(l.color, [0.45, 0.95, 0.75, 1.0]);
            gl.uniform1f(l.pointSize, 7.0);
            gl.disable(gl.DEPTH_TEST);
            gl.drawArrays(gl.POINTS, 0, wf.pointCount);
            gl.enable(gl.DEPTH_TEST);
        }

        if (!editSelection) return;

        if (editSelection.faces && editSelection.faces.size > 0) {
            const positions = [];
            for (const fi of editSelection.faces) {
                const face = mesh.faces[fi];
                if (!face || face.length < 3) continue;
                for (let i = 1; i < face.length - 1; i++) {
                    const a = mesh.vertices[face[0]];
                    const b = mesh.vertices[face[i]];
                    const c = mesh.vertices[face[i + 1]];
                    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
                }
            }
            if (positions.length > 0) {
                const prevDepth = gl.isEnabled(gl.DEPTH_TEST);
                gl.disable(gl.DEPTH_TEST);
                this.drawFlatTriangles(positions, mvp, [1.0, 0.55, 0.15, 1.0]);
                if (prevDepth) gl.enable(gl.DEPTH_TEST);
            }
        }

        if (editSelection.edges && editSelection.edges.size > 0) {
            const positions = [];
            for (const ei of editSelection.edges) {
                const edge = MeshOps.edgeFromIndex(mesh, ei);
                if (!edge) continue;
                const a = mesh.vertices[edge[0]];
                const b = mesh.vertices[edge[1]];
                positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
            }
            if (positions.length > 0) {
                const prevDepth = gl.isEnabled(gl.DEPTH_TEST);
                gl.disable(gl.DEPTH_TEST);
                this.drawFlatLines(positions, mvp, [1.0, 0.85, 0.20, 1.0]);
                if (prevDepth) gl.enable(gl.DEPTH_TEST);
            }
        }

        if (editSelection.vertices && editSelection.vertices.size > 0) {
            const gl2 = this.gl;
            const l = this.flatLocations;
            gl2.useProgram(this.flatProgram);
            for (const vi of editSelection.vertices) {
                const v = mesh.vertices[vi];
                if (!v) continue;
                const buf = gl2.createBuffer();
                gl2.bindBuffer(gl2.ARRAY_BUFFER, buf);
                gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array(v), gl2.STATIC_DRAW);
                gl2.enableVertexAttribArray(l.position);
                gl2.vertexAttribPointer(l.position, 3, gl2.FLOAT, false, 0, 0);
                gl2.uniformMatrix4fv(l.mvp, false, mvp);
                gl2.uniform4fv(l.color, [1.0, 0.35, 0.35, 1.0]);
                gl2.uniform1f(l.pointSize, 12.0);
                gl2.disable(gl2.DEPTH_TEST);
                gl2.drawArrays(gl2.POINTS, 0, 1);
                gl2.enable(gl2.DEPTH_TEST);
                gl2.deleteBuffer(buf);
            }
        }

        let anchorLocal = null;

        if (editSelection.vertices.size > 0) {
            let x = 0, y = 0, z = 0;
            for (const vi of editSelection.vertices) {
                const v = mesh.vertices[vi];
                if (!v) continue;
                x += v[0]; y += v[1]; z += v[2];
            }
            const n = editSelection.vertices.size;
            anchorLocal = [x / n, y / n, z / n];
        } else if (editSelection.edges.size > 0) {
            let x = 0, y = 0, z = 0, count = 0;
            for (const ei of editSelection.edges) {
                const edge = MeshOps.edgeFromIndex(mesh, ei);
                if (!edge) continue;
                const a = mesh.vertices[edge[0]];
                const b = mesh.vertices[edge[1]];
                x += (a[0]+b[0])/2; y += (a[1]+b[1])/2; z += (a[2]+b[2])/2;
                count++;
            }
            if (count > 0) anchorLocal = [x / count, y / count, z / count];
        } else if (editSelection.faces.size > 0) {
            let x = 0, y = 0, z = 0, count = 0;
            for (const fi of editSelection.faces) {
                const c = MeshOps.faceCenter(mesh, fi);
                x += c[0]; y += c[1]; z += c[2];
                count++;
            }
            if (count > 0) anchorLocal = [x / count, y / count, z / count];
        }

        if (anchorLocal) {
            const gl2 = this.gl;
            const l = this.flatLocations;
            gl2.useProgram(this.flatProgram);
            const buf = gl2.createBuffer();
            gl2.bindBuffer(gl2.ARRAY_BUFFER, buf);
            gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array(anchorLocal), gl2.STATIC_DRAW);
            gl2.enableVertexAttribArray(l.position);
            gl2.vertexAttribPointer(l.position, 3, gl2.FLOAT, false, 0, 0);
            gl2.uniformMatrix4fv(l.mvp, false, mvp);
            gl2.uniform4fv(l.color, [1.0, 1.0, 1.0, 1.0]);
            gl2.uniform1f(l.pointSize, 10.0);
            gl2.disable(gl2.DEPTH_TEST);
            gl2.drawArrays(gl2.POINTS, 0, 1);
            gl2.enable(gl2.DEPTH_TEST);
            gl2.deleteBuffer(buf);

            if (currentTool === "move" || currentTool === "rotate" || currentTool === "scale") {
                const world = [
                    model[0] * anchorLocal[0] + model[4] * anchorLocal[1] + model[8]  * anchorLocal[2] + model[12],
                    model[1] * anchorLocal[0] + model[5] * anchorLocal[1] + model[9]  * anchorLocal[2] + model[13],
                    model[2] * anchorLocal[0] + model[6] * anchorLocal[1] + model[10] * anchorLocal[2] + model[14]
                ];
                this.drawGizmoAt(world, camera, viewProjection, pixelHeight, currentTool, activeAxis, 61, hoverAxis);
            }
        }
    }

    render(objects, camera, selectedIds, selectedId, gizmoMode, activeAxis, editMode, viewMode, smoothLevel, hoverAxis) {

        const gl = this.gl;
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pixelWidth = Math.max(1, Math.floor(width * dpr));
        const pixelHeight = Math.max(1, Math.floor(height * dpr));

        if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
            this.canvas.width = pixelWidth;
            this.canvas.height = pixelHeight;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, pixelWidth, pixelHeight);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const projection = Matrix4.perspective(55 * Math.PI / 180, pixelWidth / pixelHeight, 0.1, 1000);
        const view = Matrix4.lookAt(camera.position, camera.target, [0, 1, 0]);
        const viewProjection = Matrix4.multiply(projection, view);

        gl.disable(gl.CULL_FACE);
        this.drawGrid(viewProjection);

        const effectiveView = editMode ? "solid" : (viewMode || "solid");
        const useSmooth = !editMode && (effectiveView === "smooth" || effectiveView === "solid-wire");
        const level = smoothLevel || 2;

        gl.useProgram(this.program);

        const selSet = selectedIds || new Set();
        for (const object of objects) {
            const buffers = this.getMeshBuffers(object.mesh, useSmooth, level);
            const model = Matrix4.compose(object.position, object.rotation, object.scale, object.pivot);
            const mvp = Matrix4.multiply(viewProjection, model);
            const l = this.locations;

            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
            gl.enableVertexAttribArray(l.position);
            gl.vertexAttribPointer(l.position, 3, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
            gl.enableVertexAttribArray(l.normal);
            gl.vertexAttribPointer(l.normal, 3, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);

            gl.uniformMatrix4fv(l.mvp, false, mvp);
            gl.uniformMatrix4fv(l.model, false, model);
            gl.uniform3fv(l.color, object.color);
            const isSelected = selSet.has(object.id) || object.id === selectedId;
            gl.uniform1f(l.selected, isSelected ? 1 : 0);

            gl.drawElements(gl.TRIANGLES, buffers.count, buffers.indexType || gl.UNSIGNED_SHORT, 0);
        }

        if (!editMode && effectiveView === "solid-wire") {
            const l = this.flatLocations;
            for (const object of objects) {
                const wf = this.getWireframeBuffers(object.mesh);
                const model = Matrix4.compose(object.position, object.rotation, object.scale, object.pivot);
                const mvp = Matrix4.multiply(viewProjection, model);

                gl.useProgram(this.flatProgram);
                gl.bindBuffer(gl.ARRAY_BUFFER, wf.edges);
                gl.enableVertexAttribArray(l.position);
                gl.vertexAttribPointer(l.position, 3, gl.FLOAT, false, 0, 0);
                gl.uniformMatrix4fv(l.mvp, false, mvp);
                gl.uniform4fv(l.color, [0.18, 0.20, 0.26, 1.0]);
                gl.uniform1f(l.pointSize, 1.0);

                gl.disable(gl.DEPTH_TEST);
                gl.drawArrays(gl.LINES, 0, wf.edgeCount);
                gl.enable(gl.DEPTH_TEST);
            }
        }

        if (editMode) {
            const editObj = objects.find(o => o.id === editMode.objectId);
            if (editObj) {
                this.drawEditOverlay(
                    editObj, editMode.selection, viewProjection, camera,
                    pixelWidth, pixelHeight,
                    editMode.currentTool, editMode.activeAxis, hoverAxis
                );
            }
        }

        const selected = objects.find(o => o.id === selectedId);
        if (selected && gizmoMode && !editMode) {
            this.drawGizmo(selected, camera, viewProjection, pixelWidth, pixelHeight, gizmoMode, activeAxis, hoverAxis);
        }

        return { view, projection, viewProjection };
    }
}