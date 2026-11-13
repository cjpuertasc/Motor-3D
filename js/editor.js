// ==========================================
// MODEL LAB - EDITOR CORE
// ==========================================

(() => {

    const $ = id => document.getElementById(id);
    const canvas = $("glCanvas");
    const overlay = $("overlayCanvas");
    const overlayCtx = overlay.getContext("2d");
    const viewport = $("viewport");
    const boxRect = $("boxSelectRect");

    const propertiesDrawer = $("propertiesDrawer");
    const togglePropsBtn = $("toggleProperties");
    const closeDrawerBtn = $("closeDrawer");

    let renderer;
    try {
        renderer = new Renderer3D(canvas);
    } catch (error) {
        $("status").textContent = error.message;
        console.error(error);
        return;
    }


    // ======================================
    // ESTADO
    // ======================================

    let objects = [];
    let groups = [];
    let nextGroupId = 1;

    let selectedIds = new Set();
    let selectedGroupId = null;
    let selectedId = null;
    let nextId = 1;
    let currentTool = "select";
    let transform = null;
    let groupTransform = null;
    let multiTransform = null;
    let drag = null;

    let viewMode = "solid";
    let smoothLevel = 2;

    let editMode = false;
    let editObjectId = null;
    let editSelection = null;

    let editTransform = null;

    let boxSelectDrag = null;
    let isRenaming = false;

    let hoverGizmo = null;

    // Knife
    let knifeActive = false;
    let knifePoints = [];
    let knifeHover = null;
    let knifeLoopPreview = null;
    let hoverLoopPreview = null;
    let lastKnifeMouse = { x: 0, y: 0 };

    const knifeOptions = {
        count: 1,
        position: 0.5,
        spread: 0.6,
        snapVertex: true,
        cutOutside: true,
        closePolyline: false,
        followMouse: true
    };

    const toolOptions = {
        select: { boxSelect: true, boxMode: "visible" },
        edit: { boxSelect: true, boxMode: "visible" }
    };

    const modelOptions = {
        bevelWidth: 0.08,
        bevelSegments: 1,
        subdivLevels: 1
    };

    let lastClickTime = 0;
    let lastClickX = 0;
    let lastClickY = 0;
    const DOUBLE_CLICK_MS = 350;
    const DOUBLE_CLICK_DIST = 6;

    const HISTORY_LIMIT = 100;
    let history = [];
    let historyIndex = -1;

    let drawerMode = "properties";
    let pendingCreateType = null;
    let createParams = null;

    const PRIMITIVE_DEFAULTS = {
        Cubo:    { x: 1, y: 1, z: 1 },
        Esfera:  { seg: 32, rings: 20 },
        Cilindro:{ seg: 32 }
    };

    // Modal de exportación
    const exportModal = $("exportModal");
    const exportNameInput = $("exportName");
    const exportMtlCheck = $("exportMtl");


    // ======================================
    // CÁMARA
    // ======================================

    const camera = {
        target: [0, 0, 0],
        radius: 9,
        yaw: Math.PI / 4,
        pitch: 0.35,
        position: [0, 0, 0]
    };

    function updateCamera() {
        camera.position = [
            camera.target[0] + camera.radius * Math.cos(camera.pitch) * Math.sin(camera.yaw),
            camera.target[1] + camera.radius * Math.sin(camera.pitch),
            camera.target[2] + camera.radius * Math.cos(camera.pitch) * Math.cos(camera.yaw)
        ];
    }

    function cameraBasis() {
        const forward = Vector3.normalize(Vector3.subtract(camera.target, camera.position));
        let right = Vector3.cross(forward, [0, 1, 0]);
        if (Math.hypot(right[0], right[1], right[2]) < 1e-6) right = [1, 0, 0];
        else right = Vector3.normalize(right);
        const up = Vector3.normalize(Vector3.cross(right, forward));
        return { forward, right, up };
    }


    // ======================================
    // PROYECCIÓN
    // ======================================

    function computeViewProjection() {
        const projection = Matrix4.perspective(55 * Math.PI / 180, canvas.width / canvas.height, 0.1, 1000);
        const view = Matrix4.lookAt(camera.position, camera.target, [0, 1, 0]);
        return Matrix4.multiply(projection, view);
    }

    function projectToScreen(point, vp) {
        const x = point[0], y = point[1], z = point[2];
        const clip = [
            vp[0]*x + vp[4]*y + vp[8]*z + vp[12],
            vp[1]*x + vp[5]*y + vp[9]*z + vp[13],
            vp[2]*x + vp[6]*y + vp[10]*z + vp[14],
            vp[3]*x + vp[7]*y + vp[11]*z + vp[15]
        ];
        if (clip[3] <= 0) return null;
        const ndcX = clip[0] / clip[3];
        const ndcY = clip[1] / clip[3];
        return [(ndcX * 0.5 + 0.5) * canvas.width, (1 - (ndcY * 0.5 + 0.5)) * canvas.height];
    }

    function objectToWorld(object, point) {
        const m = Matrix4.compose(object.position, object.rotation, object.scale, object.pivot);
        const x = point[0], y = point[1], z = point[2];
        return [
            m[0] * x + m[4] * y + m[8]  * z + m[12],
            m[1] * x + m[5] * y + m[9]  * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14]
        ];
    }

    function worldToLocal(object, point) {
        const [rx, ry, rz] = object.rotation.map(v => v * Math.PI / 180);
        const cx = Math.cos(rx), sx = Math.sin(rx);
        const cy = Math.cos(ry), sy = Math.sin(ry);
        const cz = Math.cos(rz), sz = Math.sin(rz);
        const R = [
            [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
            [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
            [-sy,     cy * sx,                cy * cx]
        ];
        const px = point[0] - object.position[0];
        const py = point[1] - object.position[1];
        const pz = point[2] - object.position[2];
        const rx2 = R[0][0]*px + R[1][0]*py + R[2][0]*pz;
        const ry2 = R[0][1]*px + R[1][1]*py + R[2][1]*pz;
        const rz2 = R[0][2]*px + R[1][2]*py + R[2][2]*pz;
        const sx2 = rx2 / (object.scale[0] || 1);
        const sy2 = ry2 / (object.scale[1] || 1);
        const sz2 = rz2 / (object.scale[2] || 1);
        const pivot = object.pivot || [0, 0, 0];
        return [sx2 + pivot[0], sy2 + pivot[1], sz2 + pivot[2]];
    }


    // ======================================
    // HISTORIAL
    // ======================================

    function cloneMesh(mesh) {
        return {
            vertices: mesh.vertices.map(v => [v[0], v[1], v[2]]),
            faces:    mesh.faces.map(f => f.slice()),
            color:    [...mesh.color],
            version:  mesh.version,
            edgeMidpoints: new Map(mesh.edgeMidpoints || [])
        };
    }

    function snapshot() {
        return {
            objects: objects.map(o => ({
                id: o.id, name: o.name, type: o.type,
                mesh: cloneMesh(o.mesh),
                position: [...o.position],
                rotation: [...o.rotation],
                scale: [...o.scale],
                pivot: [...o.pivot],
                color: [...o.color],
                visible: o.visible !== false,
                groupId: o.groupId || null
            })),
            groups: groups.map(g => ({
                id: g.id, name: g.name, visible: g.visible !== false,
                collapsed: !!g.collapsed,
                objectIds: [...g.objectIds],
                pivot: [...(g.pivot || [0, 0, 0])]
            })),
            selectedIds: new Set(selectedIds),
            selectedGroupId,
            selectedId,
            nextId,
            nextGroupId,
            toolOptions: JSON.parse(JSON.stringify(toolOptions)),
            knifeOptions: JSON.parse(JSON.stringify(knifeOptions)),
            modelOptions: JSON.parse(JSON.stringify(modelOptions))
        };
    }

    function restore(snap) {
        objects = snap.objects.map(o => ({
            ...o,
            mesh: cloneMesh(o.mesh),
            visible: o.visible !== false,
            groupId: o.groupId || null
        }));
        groups = (snap.groups || []).map(g => ({
            ...g,
            visible: g.visible !== false,
            collapsed: !!g.collapsed,
            objectIds: [...g.objectIds],
            pivot: g.pivot ? [...g.pivot] : [0, 0, 0]
        }));
        selectedIds = new Set(snap.selectedIds || []);
        selectedGroupId = snap.selectedGroupId || null;
        selectedId = snap.selectedId;
        nextId = snap.nextId;
        nextGroupId = snap.nextGroupId || 1;
        if (snap.toolOptions) Object.assign(toolOptions, snap.toolOptions);
        if (snap.knifeOptions) Object.assign(knifeOptions, snap.knifeOptions);
        if (snap.modelOptions) Object.assign(modelOptions, snap.modelOptions);
        transform = null;
        groupTransform = null;
        multiTransform = null;
        editTransform = null;
        if (editMode && selectedId !== editObjectId) exitEditMode();
        if (editSelection) {
            editSelection.vertices.clear();
            editSelection.edges.clear();
            editSelection.faces.clear();
        }
        updateOutliner();
        updateProperties();
        updateToolOptions();
        refreshToolsGrid();
        render();
    }

    function pushHistory() {
        if (historyIndex < history.length - 1) history = history.slice(0, historyIndex + 1);
        history.push(snapshot());
        if (history.length > HISTORY_LIMIT) history.shift();
        historyIndex = history.length - 1;
    }

    function undo() {
        if (historyIndex <= 0) { setStatus("Nada que deshacer"); return; }
        historyIndex--;
        restore(history[historyIndex]);
        setStatus("Deshecho");
    }

    function redo() {
        if (historyIndex >= history.length - 1) { setStatus("Nada que rehacer"); return; }
        historyIndex++;
        restore(history[historyIndex]);
        setStatus("Rehecho");
    }


    // ======================================
    // OBJETOS Y GRUPOS
    // ======================================

    function getSelected() {
        return objects.find(o => o.id === selectedId) || null;
    }
    function getEditObject() {
        return objects.find(o => o.id === editObjectId) || null;
    }
    function getGroup(id) {
        return groups.find(g => g.id === id) || null;
    }
    function meshCenter(mesh) {
        if (!mesh.vertices.length) return [0, 0, 0];
        let sx = 0, sy = 0, sz = 0;
        for (const v of mesh.vertices) { sx += v[0]; sy += v[1]; sz += v[2]; }
        const n = mesh.vertices.length;
        return [sx / n, sy / n, sz / n];
    }

    function isObjectVisible(obj) {
        if (obj.visible === false) return false;
        if (obj.groupId !== null && obj.groupId !== undefined) {
            const g = getGroup(obj.groupId);
            if (g && g.visible === false) return false;
        }
        return true;
    }

    function groupCenter(g) {
        if (!g || g.objectIds.length === 0) return [0, 0, 0];
        let x = 0, y = 0, z = 0, count = 0;
        g.objectIds.forEach(id => {
            const o = objects.find(ob => ob.id === id);
            if (!o) return;
            const m = Matrix4.compose(o.position, o.rotation, o.scale, o.pivot);
            x += m[12]; y += m[13]; z += m[14];
            count++;
        });
        if (count === 0) return [0, 0, 0];
        return [x / count, y / count, z / count];
    }

    function objectWorldCenter(o) {
        const m = Matrix4.compose(o.position, o.rotation, o.scale, o.pivot);
        return [m[12], m[13], m[14]];
    }

    function objectWorldPivot(o) {
        const m = Matrix4.compose(o.position, o.rotation, o.scale, o.pivot);
        const p = o.pivot || [0, 0, 0];
        return [
            m[0]*p[0] + m[4]*p[1] + m[8] *p[2] + m[12],
            m[1]*p[0] + m[5]*p[1] + m[9] *p[2] + m[13],
            m[2]*p[0] + m[6]*p[1] + m[10]*p[2] + m[14]
        ];
    }

    function objectWorldAABB(o) {
        const verts = o.mesh.vertices;
        if (verts.length === 0) {
            const c = objectWorldCenter(o);
            return { min: [...c], max: [...c] };
        }
        let lminX = Infinity, lminY = Infinity, lminZ = Infinity;
        let lmaxX = -Infinity, lmaxY = -Infinity, lmaxZ = -Infinity;
        for (const v of verts) {
            if (v[0] < lminX) lminX = v[0];
            if (v[1] < lminY) lminY = v[1];
            if (v[2] < lminZ) lminZ = v[2];
            if (v[0] > lmaxX) lmaxX = v[0];
            if (v[1] > lmaxY) lmaxY = v[1];
            if (v[2] > lmaxZ) lmaxZ = v[2];
        }
        const corners = [
            [lminX, lminY, lminZ], [lmaxX, lminY, lminZ],
            [lminX, lmaxY, lminZ], [lmaxX, lmaxY, lminZ],
            [lminX, lminY, lmaxZ], [lmaxX, lminY, lmaxZ],
            [lminX, lmaxY, lmaxZ], [lmaxX, lmaxY, lmaxZ]
        ];
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const c of corners) {
            const w = objectToWorld(o, c);
            if (w[0] < minX) minX = w[0];
            if (w[1] < minY) minY = w[1];
            if (w[2] < minZ) minZ = w[2];
            if (w[0] > maxX) maxX = w[0];
            if (w[1] > maxY) maxY = w[1];
            if (w[2] > maxZ) maxZ = w[2];
        }
        return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
    }

    function aabbOfObjects(objs) {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let any = false;
        for (const o of objs) {
            const aabb = objectWorldAABB(o);
            any = true;
            if (aabb.min[0] < minX) minX = aabb.min[0];
            if (aabb.min[1] < minY) minY = aabb.min[1];
            if (aabb.min[2] < minZ) minZ = aabb.min[2];
            if (aabb.max[0] > maxX) maxX = aabb.max[0];
            if (aabb.max[1] > maxY) maxY = aabb.max[1];
            if (aabb.max[2] > maxZ) maxZ = aabb.max[2];
        }
        if (!any) return null;
        return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
    }


    // ======================================
    // CREACIÓN DIFERIDA
    // ======================================

    function buildMeshFromParams(type, params) {
        if (type === "Cubo")     return Geometry.Cubo(params.x, params.y, params.z);
        if (type === "Esfera")   return Geometry.Esfera(params.seg, params.rings);
        if (type === "Cilindro") return Geometry.Cilindro(params.seg);
        return null;
    }

    function openCreateDrawer(type) {
        createMenu.hidden = true;
        pendingCreateType = type;
        createParams = { ...PRIMITIVE_DEFAULTS[type] };
        drawerMode = "create";
        openDrawer();
        renderPropertiesDrawer();
        setStatus("Configura " + type + " y pulsa Crear");
    }

    function commitCreateObject() {
        if (!pendingCreateType || !createParams) return;
        const type = pendingCreateType;
        const params = createParams;
        pushHistory();
        const mesh = buildMeshFromParams(type, params);
        if (!mesh) return;
        const object = {
            id: nextId++,
            name: type + "_" + (nextId - 1),
            type,
            mesh,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            pivot: meshCenter(mesh),
            color: [...mesh.color],
            visible: true,
            groupId: null
        };
        objects.push(object);
        selectedIds.clear();
        selectedIds.add(object.id);
        selectedGroupId = null;
        selectedId = object.id;
        pendingCreateType = null;
        createParams = null;
        drawerMode = "properties";
        closeDrawer();
        updateOutliner();
        updateProperties();
        updateToolOptions();
        refreshToolsGrid();
        render();
        setStatus(type + " creado");
    }


    // ======================================
    // SELECCIÓN
    // ======================================

    function setSelection(ids, activeId = null) {
        selectedIds = new Set(ids);
        selectedGroupId = null;
        if (activeId !== null) selectedId = activeId;
        else if (selectedIds.size > 0) selectedId = Array.from(selectedIds)[selectedIds.size - 1];
        else selectedId = null;
        updateOutliner();
        updateProperties();
        refreshToolsGrid();
        const o = getSelected();
        $("selectionInfo").textContent = selectedIds.size > 1
            ? selectedIds.size + " objetos seleccionados"
            : (o ? o.name : "Sin selección");
        if (editMode && selectedId !== editObjectId) exitEditMode();
    }

    function selectObject(id) {
        if (id === null) setSelection([], null);
        else setSelection([id], id);
    }

    function toggleObjectSelection(id) {
        if (selectedIds.has(id)) {
            selectedIds.delete(id);
            if (selectedId === id) {
                selectedId = selectedIds.size > 0 ? Array.from(selectedIds)[selectedIds.size - 1] : null;
            }
        } else {
            selectedIds.add(id);
            selectedId = id;
        }
        selectedGroupId = null;
        updateOutliner();
        updateProperties();
        refreshToolsGrid();
        const o = getSelected();
        $("selectionInfo").textContent = selectedIds.size > 1
            ? selectedIds.size + " objetos seleccionados"
            : (o ? o.name : "Sin selección");
        if (editMode && selectedId !== editObjectId) exitEditMode();
    }

    function selectGroup(id) {
        selectedGroupId = id;
        selectedIds.clear();
        selectedId = null;
        updateOutliner();
        updateProperties();
        refreshToolsGrid();
        const g = getGroup(id);
        $("selectionInfo").textContent = g ? "Grupo: " + g.name : "Sin selección";
    }

    function getLastSelected() {
        return objects.find(o => o.id === selectedId) || null;
    }


    // ======================================
    // OUTLINER
    // ======================================

    function updateOutliner() {
        if (isRenaming) return;

        const outliner = $("outliner");
        outliner.innerHTML = "";

        groups.forEach(g => {
            const groupEl = document.createElement("div");
            groupEl.className = "outliner-group";

            const row = document.createElement("div");
            row.className = "group-row" + (selectedGroupId === g.id ? " selected-group" : "");
            row.dataset.groupId = g.id;

            const expand = document.createElement("span");
            expand.className = "group-expand" + (g.collapsed ? " collapsed" : "");
            expand.textContent = "▼";
            expand.onclick = (e) => {
                e.stopPropagation();
                toggleGroupCollapsed(g.id);
            };

            const eye = document.createElement("span");
            eye.className = "visibility-toggle" + (g.visible === false ? " off" : "");
            eye.textContent = g.visible === false ? "◌" : "◉";
            eye.title = g.visible === false ? "Mostrar grupo" : "Ocultar grupo";
            eye.onclick = (e) => {
                e.stopPropagation();
                toggleGroupVisibility(g.id);
            };

            const icon = document.createElement("span");
            icon.className = "group-icon";
            icon.textContent = "▤";

            const name = document.createElement("span");
            name.className = "group-name";
            name.textContent = g.name;
            name.title = "Doble clic para renombrar";
            name.ondblclick = (e) => {
                e.stopPropagation();
                startRenameGroup(g.id, name);
            };

            const count = document.createElement("span");
            count.className = "group-count";
            count.textContent = g.objectIds.length;

            const ungroupBtn = document.createElement("button");
            ungroupBtn.className = "object-action-btn";
            ungroupBtn.textContent = "✕";
            ungroupBtn.title = "Desagrupar";
            ungroupBtn.onclick = (e) => {
                e.stopPropagation();
                ungroup(g.id);
            };

            row.append(expand, eye, icon, name, count, ungroupBtn);
            row.onclick = (event) => {
                if (event.shiftKey || event.ctrlKey || event.metaKey) {
                    if (selectedGroupId === g.id) selectedGroupId = null;
                    else selectedGroupId = g.id;
                } else {
                    selectGroup(g.id);
                }
                updateOutliner();
                updateProperties();
                render();
            };
            groupEl.appendChild(row);

            if (!g.collapsed) {
                const children = document.createElement("div");
                children.className = "group-children";
                g.objectIds.forEach(oid => {
                    const obj = objects.find(o => o.id === oid);
                    if (!obj) return;
                    const objRow = createObjectRow(obj);
                    children.appendChild(objRow);
                });
                groupEl.appendChild(children);
            }

            outliner.appendChild(groupEl);
        });

        objects.forEach(o => {
            if (o.groupId !== null && o.groupId !== undefined) return;
            const objRow = createObjectRow(o);
            outliner.appendChild(objRow);
        });

        $("hierarchyCount").textContent = objects.length;
    }

    function createObjectRow(o) {
        const btn = document.createElement("div");
        btn.className = "object-row";
        btn.dataset.objectId = o.id;
        if (selectedIds.has(o.id)) btn.classList.add("selected");
        if (o.visible === false) btn.classList.add("hidden-object");
        btn.title = o.name;

        const eye = document.createElement("span");
        eye.className = "visibility-toggle" + (o.visible === false ? " off" : "");
        eye.textContent = o.visible === false ? "◌" : "◉";
        eye.title = o.visible === false ? "Mostrar objeto" : "Ocultar objeto";
        eye.onclick = (e) => {
            e.stopPropagation();
            toggleObjectVisibility(o.id);
        };

        const icon = document.createElement("span");
        icon.className = "object-icon";
        icon.textContent = o.type === "Esfera" ? "◯" : o.type === "Cilindro" ? "▯" : "◈";

        const name = document.createElement("span");
        name.className = "object-name";
        name.textContent = o.name;
        name.ondblclick = (e) => {
            e.stopPropagation();
            startRenameObject(o.id, name);
        };

        if (o.groupId !== null && o.groupId !== undefined) {
            const removeBtn = document.createElement("button");
            removeBtn.className = "object-action-btn";
            removeBtn.textContent = "↩";
            removeBtn.title = "Quitar del grupo";
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                removeFromGroup(o.id);
            };
            btn.append(eye, icon, name, removeBtn);
        } else {
            btn.append(eye, icon, name);
        }

        btn.addEventListener("mousedown", (e) => {
            if (e.target.closest(".rename-input")) e.stopPropagation();
        });

        btn.addEventListener("click", (event) => {
            if (isRenaming) return;
            if (event.target.closest(".rename-input")) return;
            if (event.target.closest(".visibility-toggle") ||
                event.target.closest(".object-action-btn")) return;
            if (event.shiftKey || event.ctrlKey || event.metaKey) toggleObjectSelection(o.id);
            else selectObject(o.id);
            render();
        });

        return btn;
    }

    function startRenameObject(id, nameEl) {
        const obj = objects.find(o => o.id === id);
        if (!obj) return;
        isRenaming = true;
        const input = document.createElement("input");
        input.type = "text";
        input.className = "rename-input";
        input.value = obj.name;
        nameEl.replaceWith(input);

        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });

        input.addEventListener("mousedown", (e) => e.stopPropagation());
        input.addEventListener("click", (e) => e.stopPropagation());
        input.addEventListener("dblclick", (e) => e.stopPropagation());
        input.addEventListener("pointerdown", (e) => e.stopPropagation());

        let committed = false;
        const commit = () => {
            if (committed) return;
            committed = true;
            const newName = input.value.trim();
            if (newName && newName !== obj.name) {
                pushHistory();
                obj.name = newName;
            }
            isRenaming = false;
            updateOutliner();
            updateProperties();
            render();
        };

        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); input.blur(); }
            if (e.key === "Escape") {
                e.preventDefault();
                input.value = obj.name;
                input.blur();
            }
        });
    }

    function startRenameGroup(id, nameEl) {
        const g = getGroup(id);
        if (!g) return;
        isRenaming = true;
        const input = document.createElement("input");
        input.type = "text";
        input.className = "rename-input";
        input.value = g.name;
        nameEl.replaceWith(input);

        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });

        input.addEventListener("mousedown", (e) => e.stopPropagation());
        input.addEventListener("click", (e) => e.stopPropagation());
        input.addEventListener("dblclick", (e) => e.stopPropagation());
        input.addEventListener("pointerdown", (e) => e.stopPropagation());

        let committed = false;
        const commit = () => {
            if (committed) return;
            committed = true;
            const newName = input.value.trim();
            if (newName && newName !== g.name) {
                pushHistory();
                g.name = newName;
            }
            isRenaming = false;
            updateOutliner();
            updateProperties();
        };

        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); input.blur(); }
            if (e.key === "Escape") {
                e.preventDefault();
                input.value = g.name;
                input.blur();
            }
        });
    }


    // ======================================
    // ACCIONES DE GRUPOS Y VISIBILIDAD
    // ======================================

    function createGroupFromSelection() {
        if (selectedIds.size === 0) {
            setStatus("Selecciona al menos un objeto para agrupar");
            return;
        }
        pushHistory();
        const g = {
            id: nextGroupId++,
            name: "Grupo_" + (nextGroupId - 1),
            visible: true,
            collapsed: false,
            objectIds: Array.from(selectedIds),
            pivot: [0, 0, 0]
        };
        g.objectIds.forEach(oid => {
            const o = objects.find(ob => ob.id === oid);
            if (o) o.groupId = g.id;
        });
        g.pivot = groupCenter(g);
        groups.push(g);
        updateOutliner();
        render();
        setStatus("Grupo '" + g.name + "' creado con " + g.objectIds.length + " objetos");
    }

    function ungroup(groupId) {
        const g = getGroup(groupId);
        if (!g) return;
        pushHistory();
        g.objectIds.forEach(oid => {
            const o = objects.find(ob => ob.id === oid);
            if (o) o.groupId = null;
        });
        groups = groups.filter(gr => gr.id !== groupId);
        if (selectedGroupId === groupId) selectedGroupId = null;
        updateOutliner();
        updateProperties();
        render();
        setStatus("Grupo desagrupado");
    }

    function removeFromGroup(objectId) {
        const o = objects.find(ob => ob.id === objectId);
        if (!o || o.groupId === null) return;
        const g = getGroup(o.groupId);
        if (!g) return;
        pushHistory();
        g.objectIds = g.objectIds.filter(id => id !== objectId);
        o.groupId = null;
        if (g.objectIds.length === 0) {
            groups = groups.filter(gr => gr.id !== g.id);
        }
        updateOutliner();
        render();
        setStatus("Objeto quitado del grupo");
    }

    function toggleObjectVisibility(id) {
        const o = objects.find(ob => ob.id === id);
        if (!o) return;
        pushHistory();
        o.visible = o.visible === false ? true : false;
        updateOutliner();
        render();
        setStatus((o.visible ? "Mostrado" : "Oculto") + ": " + o.name);
    }

    function toggleGroupVisibility(id) {
        const g = getGroup(id);
        if (!g) return;
        pushHistory();
        g.visible = g.visible === false ? true : false;
        updateOutliner();
        render();
        setStatus((g.visible ? "Mostrado" : "Oculto") + " grupo: " + g.name);
    }

    function toggleGroupCollapsed(id) {
        const g = getGroup(id);
        if (!g) return;
        g.collapsed = !g.collapsed;
        updateOutliner();
    }

    function toggleSelectedVisibility() {
        if (selectedIds.size === 0) { setStatus("Nada seleccionado"); return; }
        pushHistory();
        const selectedObjs = objects.filter(o => selectedIds.has(o.id));
        const allHidden = selectedObjs.every(o => o.visible === false);
        selectedObjs.forEach(o => o.visible = allHidden ? true : false);
        updateOutliner();
        render();
        setStatus(allHidden ? "Mostrados" : "Ocultos");
    }

    function showAll() {
        pushHistory();
        objects.forEach(o => o.visible = true);
        groups.forEach(g => g.visible = true);
        updateOutliner();
        render();
        setStatus("Mostrados todos");
    }

    function hideAllExceptSelected() {
        if (selectedIds.size === 0) { setStatus("Selecciona algo"); return; }
        pushHistory();
        objects.forEach(o => { o.visible = selectedIds.has(o.id); });
        groups.forEach(g => { g.visible = true; });
        updateOutliner();
        render();
        setStatus("Oculto el resto");
    }


    // ======================================
    // DRAWER PROPIEDADES
    // ======================================

    function openDrawer() {
        propertiesDrawer.hidden = false;
        togglePropsBtn.classList.add("active");
    }

    function closeDrawer() {
        propertiesDrawer.hidden = true;
        togglePropsBtn.classList.remove("active");
        if (drawerMode === "create") {
            drawerMode = null;
            pendingCreateType = null;
            createParams = null;
        }
    }

    function toggleDrawer() {
        if (propertiesDrawer.hidden) {
            if (drawerMode === null || (drawerMode === "create" && !pendingCreateType)) {
                drawerMode = "properties";
            }
            openDrawer();
            renderPropertiesDrawer();
        } else {
            closeDrawer();
        }
    }

    function updateProperties() {
        renderPropertiesDrawer();
    }

    function renderPropertiesDrawer() {
        if (propertiesDrawer.hidden) return;
        if (drawerMode === null) drawerMode = "properties";
        const container = $("properties");
        container.innerHTML = "";

        if (drawerMode === "create") {
            renderCreateProperties(container);
            return;
        }

        if (selectedGroupId !== null) {
            const g = getGroup(selectedGroupId);
            if (g) { renderGroupProperties(container, g); return; }
        }

        const object = getSelected();
        if (!object) {
            const p = document.createElement("p");
            p.className = "muted";
            p.textContent = "Selecciona un objeto para ver sus propiedades.";
            container.appendChild(p);
            return;
        }

        if (selectedIds.size > 1) {
            const info = document.createElement("p");
            info.className = "muted";
            info.textContent = selectedIds.size + " objetos seleccionados. Activo: " + object.name + ".";
            container.appendChild(info);
        }

        renderObjectProperties(container, object);
    }

    function renderCreateProperties(container) {
        const head = document.createElement("div");
        head.className = "property-heading";
        head.textContent = "NUEVO " + pendingCreateType.toUpperCase();
        container.appendChild(head);

        const block = document.createElement("div");
        block.className = "property-block";

        const paramRow = (label, key, min, max) => {
            const row = document.createElement("div");
            row.className = "option-number-row";
            const lbl = document.createElement("label");
            lbl.textContent = label;
            const input = document.createElement("input");
            input.type = "number";
            input.min = String(min);
            input.max = String(max);
            input.value = String(createParams[key]);
            input.addEventListener("change", () => {
                let v = parseInt(input.value) || min;
                v = Math.max(min, Math.min(max, v));
                createParams[key] = v;
                input.value = String(v);
            });
            row.append(lbl, input);
            return row;
        };

        if (pendingCreateType === "Cubo") {
            block.appendChild(paramRow("Divisiones X", "x", 1, 20));
            block.appendChild(paramRow("Divisiones Y", "y", 1, 20));
            block.appendChild(paramRow("Divisiones Z", "z", 1, 20));
        } else if (pendingCreateType === "Esfera") {
            block.appendChild(paramRow("Segmentos", "seg", 3, 128));
            block.appendChild(paramRow("Anillos",   "rings", 2, 64));
        } else if (pendingCreateType === "Cilindro") {
            block.appendChild(paramRow("Segmentos", "seg", 3, 128));
        }

        container.appendChild(block);

        const btnRow = document.createElement("div");
        btnRow.style.display = "grid";
        btnRow.style.gridTemplateColumns = "1fr 1fr";
        btnRow.style.gap = "6px";

        const cancel = document.createElement("button");
        cancel.textContent = "Cancelar";
        cancel.onclick = () => {
            pendingCreateType = null;
            createParams = null;
            drawerMode = null;
            closeDrawer();
        };

        const create = document.createElement("button");
        create.textContent = "Crear";
        create.className = "btn-primary";
        create.onclick = () => commitCreateObject();

        btnRow.append(cancel, create);
        container.appendChild(btnRow);
    }

    function makeVectorBlock(container, title, label, values, object, property, minValue) {
        const block = document.createElement("div");
        block.className = "property-block";
        const heading = document.createElement("div");
        heading.className = "property-heading";
        heading.textContent = title;
        block.appendChild(heading);
        const row = document.createElement("div");
        row.className = "field-row";
        const lbl = document.createElement("label");
        lbl.textContent = label;
        row.appendChild(lbl);
        ["X", "Y", "Z"].forEach((axis, i) => {
            const input = document.createElement("input");
            input.type = "number";
            input.step = "0.1";
            input.value = Number(values[i].toFixed(3));
            input.classList.add("axis-" + axis.toLowerCase() + "-input");
            input.addEventListener("change", () => {
                const cur = getSelected();
                if (!cur) return;
                pushHistory();
                let v = Number(input.value) || 0;
                if (minValue !== undefined) v = Math.max(minValue, v);
                if (property === "pivot") cur.pivot[i] = v;
                else cur[property][i] = v;
                render();
                updateProperties();
            });
            row.appendChild(input);
        });
        block.appendChild(row);
        container.appendChild(block);
    }

    function renderObjectProperties(container, object) {
        makeVectorBlock(container, "TRANSFORMACIÓN · POSICIÓN", "Pos", object.position, object, "position");
        makeVectorBlock(container, "TRANSFORMACIÓN · ROTACIÓN", "Rot", object.rotation, object, "rotation");
        makeVectorBlock(container, "TRANSFORMACIÓN · ESCALA",   "Esc", object.scale,    object, "scale", 0.01);
        makeVectorBlock(container, "PIVOT (LOCAL)", "Piv", object.pivot || [0, 0, 0], object, "pivot");

        const centerBtn = document.createElement("button");
        centerBtn.textContent = "Centrar pivot en geometría";
        centerBtn.onclick = () => {
            const cur = getSelected();
            if (!cur) return;
            pushHistory();
            cur.pivot = meshCenter(cur.mesh);
            render();
            updateProperties();
        };
        container.appendChild(centerBtn);

        const colorRow = document.createElement("div");
        colorRow.className = "color-row";
        const lbl = document.createElement("label");
        lbl.textContent = "Color del objeto";
        const input = document.createElement("input");
        input.type = "color";
        input.value = rgbToHex(object.color);
        input.addEventListener("input", () => {
            const cur = getSelected();
            if (!cur) return;
            cur.color = hexToRgb(input.value);
            render();
        });
        input.addEventListener("change", () => pushHistory());
        colorRow.append(lbl, input);
        container.appendChild(colorRow);

        const viewInfo = document.createElement("p");
        viewInfo.className = "muted";
        viewInfo.style.fontSize = "10px";
        viewInfo.style.lineHeight = "1.7";
        viewInfo.innerHTML =
            "Vista: <b>" + viewModeName(viewMode) + "</b><br>" +
            "1 / 2 / 3 = solid / smooth+cage / smooth<br>" +
            "PageUp / PageDown = nivel suavizado";
        container.appendChild(viewInfo);
    }

    function renderGroupProperties(container, g) {
        const heading = document.createElement("div");
        heading.className = "property-heading";
        heading.textContent = "GRUPO";
        container.appendChild(heading);

        const nameBlock = document.createElement("div");
        nameBlock.className = "property-block";
        const nameLbl = document.createElement("div");
        nameLbl.className = "property-heading";
        nameLbl.textContent = "Nombre";
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.value = g.name;
        nameInput.style.width = "100%";
        nameInput.addEventListener("change", () => {
            pushHistory();
            g.name = nameInput.value.trim() || g.name;
            updateOutliner();
        });
        nameBlock.append(nameLbl, nameInput);
        container.appendChild(nameBlock);

        const pivotBlock = document.createElement("div");
        pivotBlock.className = "property-block";
        const pivotHeading = document.createElement("div");
        pivotHeading.className = "property-heading";
        pivotHeading.textContent = "PIVOT DEL GRUPO (MUNDO)";
        pivotBlock.appendChild(pivotHeading);

        const pivotRow = document.createElement("div");
        pivotRow.className = "field-row";
        const pivotLbl = document.createElement("label");
        pivotLbl.textContent = "Piv";
        pivotRow.appendChild(pivotLbl);

        ["X", "Y", "Z"].forEach((axis, i) => {
            const input = document.createElement("input");
            input.type = "number";
            input.step = "0.1";
            input.value = Number((g.pivot || [0, 0, 0])[i].toFixed(3));
            input.classList.add("axis-" + axis.toLowerCase() + "-input");
            input.addEventListener("change", () => {
                if (!g.pivot) g.pivot = [0, 0, 0];
                g.pivot[i] = Number(input.value) || 0;
                render();
            });
            pivotRow.appendChild(input);
        });
        pivotBlock.appendChild(pivotRow);
        container.appendChild(pivotBlock);

        const centerBtn = document.createElement("button");
        centerBtn.textContent = "Centrar pivot en el grupo";
        centerBtn.onclick = () => {
            pushHistory();
            g.pivot = groupCenter(g);
            render();
            updateProperties();
        };
        container.appendChild(centerBtn);

        const info = document.createElement("p");
        info.className = "muted";
        info.style.fontSize = "11px";
        info.textContent = g.objectIds.length + " objetos en el grupo.";
        container.appendChild(info);

        const ungroupBtn = document.createElement("button");
        ungroupBtn.textContent = "Desagrupar";
        ungroupBtn.onclick = () => ungroup(g.id);
        container.appendChild(ungroupBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Eliminar grupo y objetos";
        deleteBtn.onclick = () => {
            if (!confirm("¿Eliminar el grupo '" + g.name + "' y todos sus objetos?")) return;
            pushHistory();
            g.objectIds.forEach(oid => {
                objects = objects.filter(o => o.id !== oid);
            });
            groups = groups.filter(gr => gr.id !== g.id);
            selectedGroupId = null;
            selectedIds.clear();
            selectedId = null;
            updateOutliner();
            updateProperties();
            render();
            setStatus("Grupo eliminado");
        };
        container.appendChild(deleteBtn);
    }

    function rgbToHex(c) {
        return "#" + c.map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
    }
    function hexToRgb(hex) {
        return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    }


    // ======================================
    // GRID DE HERRAMIENTAS
    // ======================================

    function toolIconSVG(name) {
        const map = {
            combine: '<path d="M8 6 H16 A2 2 0 0 1 18 8 V16 A2 2 0 0 1 16 18 H8 A2 2 0 0 1 6 16 V8 A2 2 0 0 1 8 6 Z M12 10 V14 M10 12 H14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
            separate:'<path d="M4 4 L10 10 M20 20 L14 14 M10 14 L4 20 M14 10 L20 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
            extrude: '<path d="M6 18 L6 8 L14 8 L14 4 L20 10 L14 16 L14 12 L10 12 L10 18 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
            subdiv:  '<path d="M4 4 H20 V20 H4 Z M4 12 H20 M12 4 V20" fill="none" stroke="currentColor" stroke-width="1.6"/>',
            subdivAll:'<path d="M4 4 H20 V20 H4 Z M8 8 H16 V16 H8 Z M4 4 L8 8 M20 4 L16 8 M4 20 L8 16 M20 20 L16 16" fill="none" stroke="currentColor" stroke-width="1.5"/>',
            inset:   '<path d="M4 4 H20 V20 H4 Z M8 8 H16 V16 H8 Z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
            bridge:  '<path d="M4 6 H8 M16 6 H20 M4 18 H8 M16 18 H20 M8 6 V18 M16 6 V18 M8 12 H16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
            merge:   '<path d="M12 4 V12 L6 18 M12 12 L18 18 M6 18 H18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
            mergeLast:'<path d="M4 12 H12 L18 6 M12 12 L18 18 M18 6 V12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
            flip:    '<path d="M4 12 A8 8 0 0 1 20 12 M20 12 L17 9 M20 12 L23 9 M20 12 A8 8 0 0 1 4 12 M4 12 L1 9 M4 12 L7 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
            knife:   '<path d="M14 4 L20 10 L16 14 L10 8 Z M10 8 L4 20 L8 20 L14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
            delete:  '<path d="M5 7 H19 M9 7 V5 H15 V7 M7 7 L8 20 H16 L17 7 M11 11 V16 M13 11 V16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
        };
        return map[name] || "";
    }

    function buildToolsGrid() {
        const grid = $("toolsGrid");
        if (!grid) return;
        grid.innerHTML = "";

        const tools = [
            { id: "combine",   label: "Combinar",        key: "Ctrl+J",       icon: "combine",   fn: () => doCombineObjects() },
            { id: "separate",  label: "Separar",         key: "Ctrl+Shift+J", icon: "separate",  fn: () => doSeparateObject() },
            { id: "extrude",   label: "Extruir",         key: "Ctrl+E",       icon: "extrude",   fn: () => doExtrude() },
            { id: "subdivFace",label: "Subdividir",      key: "Ctrl+R",       icon: "subdiv",    fn: () => doSubdivide() },
            { id: "subdivAll", label: "Subdiv. global",  key: "Ctrl+Shift+S", icon: "subdivAll", fn: () => doSubdivideAll() },
            { id: "inset",     label: "Inset",           key: "",             icon: "inset",     fn: () => doInset() },
            { id: "bridge",    label: "Bridge",          key: "B",            icon: "bridge",    fn: () => doBridge() },
            { id: "merge",     label: "Merge",           key: "M",            icon: "merge",     fn: () => doMergeContextual("center") },
            { id: "mergeLast", label: "Merge last",      key: "Shift+M",      icon: "mergeLast", fn: () => doMergeContextual("last") },
            { id: "flip",      label: "Flip normals",    key: "Ctrl+Shift+N", icon: "flip",      fn: () => doFlipNormals() },
            { id: "knife",     label: "Knife",           key: "K",            icon: "knife",     fn: () => enterKnifeMode() },
            { id: "delete",    label: "Borrar",          key: "X",            icon: "delete",    fn: () => doDeleteSelected(), danger: true }
        ];

        tools.forEach(t => {
            const card = document.createElement("button");
            card.className = "tool-card" + (t.danger ? " danger" : "");
            card.type = "button";
            card.title = t.label + (t.key ? " (" + t.key + ")" : "");
            card.dataset.toolId = t.id;

            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("width", "22");
            svg.setAttribute("height", "22");
            svg.innerHTML = toolIconSVG(t.icon);
            card.appendChild(svg);

            const lbl = document.createElement("span");
            lbl.className = "tool-label";
            lbl.textContent = t.label;
            card.appendChild(lbl);

            if (t.key) {
                const key = document.createElement("span");
                key.className = "tool-key";
                key.textContent = t.key;
                card.appendChild(key);
            }

            card.addEventListener("click", () => {
                if (card.classList.contains("disabled")) {
                    setStatus("Acción no disponible ahora");
                    return;
                }
                t.fn();
                refreshToolsGrid();
            });

            grid.appendChild(card);
        });

        refreshToolsGrid();
    }

    function refreshToolsGrid() {
        const grid = $("toolsGrid");
        if (!grid) return;
        grid.querySelectorAll(".tool-card").forEach(card => {
            const id = card.dataset.toolId;
            const enabled = {
                combine:   selectedIds.size >= 2,
                separate:  selectedIds.size === 1,
                extrude:   editMode,
                subdivFace:editMode,
                subdivAll: selectedIds.size === 1 || editMode,
                inset:     editMode,
                bridge:    editMode,
                merge:     editMode,
                mergeLast: editMode,
                flip:      editMode || selectedIds.size > 0,
                knife:     !knifeActive && (selectedId !== null || editMode),
                delete:    editMode
            }[id];
            card.classList.toggle("disabled", !enabled);
        });
    }


    // ======================================
    // OPCIONES DE HERRAMIENTA
    // ======================================

    function updateToolOptions() {
        const container = $("toolOptions");
        if (!container) return;
        container.innerHTML = "";

        if (knifeActive) {
            renderKnifeOptions(container);
            return;
        }

        if (editMode) {
            renderEditOptions(container);
            return;
        }

        if (currentTool === "select") renderSelectOptions(container);
        else renderNoOptions(container, currentTool, "Sin opciones adicionales.");
    }

    function renderKnifeOptions(container) {
        const group = document.createElement("div");
        group.className = "tool-options-group";

        const heading = document.createElement("div");
        heading.className = "tool-options-heading";
        heading.textContent = "KNIFE / MULTICUT";
        group.appendChild(heading);

        const countRow = document.createElement("div");
        countRow.className = "option-number-row";
        const countLbl = document.createElement("label");
        countLbl.textContent = "Cortes del loop";
        const countInput = document.createElement("input");
        countInput.type = "number";
        countInput.min = 1;
        countInput.max = 10;
        countInput.value = knifeOptions.count;
        countInput.addEventListener("change", () => {
            knifeOptions.count = Math.max(1, Math.min(10, parseInt(countInput.value) || 1));
            if (knifeLoopPreview) knifeLoopPreview.count = knifeOptions.count;
            drawOverlay();
        });
        countRow.append(countLbl, countInput);
        group.appendChild(countRow);

        const posRow = document.createElement("div");
        posRow.className = "option-range-row";
        const posLbl = document.createElement("label");
        posLbl.textContent = "Posición loop";
        const posRange = document.createElement("input");
        posRange.type = "range";
        posRange.min = "10";
        posRange.max = "90";
        posRange.step = "10";
        posRange.value = String(Math.round(knifeOptions.position * 100));
        const posVal = document.createElement("span");
        posVal.className = "option-range-value";
        posVal.textContent = Math.round(knifeOptions.position * 100) + "%";
        posRange.addEventListener("input", () => {
            knifeOptions.position = parseInt(posRange.value) / 100;
            posVal.textContent = posRange.value + "%";
            if (knifeLoopPreview) knifeLoopPreview.position = knifeOptions.position;
            drawOverlay();
        });
        posRow.append(posLbl, posRange, posVal);
        group.appendChild(posRow);

        const followRow = document.createElement("label");
        followRow.className = "option-row";
        const followCheck = document.createElement("input");
        followCheck.type = "checkbox";
        followCheck.checked = knifeOptions.followMouse;
        followCheck.addEventListener("change", () => {
            knifeOptions.followMouse = followCheck.checked;
        });
        const followLbl = document.createElement("span");
        followLbl.className = "option-row-label";
        followLbl.textContent = "Loop sigue al mouse";
        followRow.append(followCheck, followLbl);
        group.appendChild(followRow);

        const spreadRow = document.createElement("div");
        spreadRow.className = "option-range-row";
        const spreadLbl = document.createElement("label");
        spreadLbl.textContent = "Spread";
        const spreadRange = document.createElement("input");
        spreadRange.type = "range";
        spreadRange.min = "10";
        spreadRange.max = "80";
        spreadRange.step = "5";
        spreadRange.value = String(Math.round(knifeOptions.spread * 100));
        const spreadVal = document.createElement("span");
        spreadVal.className = "option-range-value";
        spreadVal.textContent = Math.round(knifeOptions.spread * 100) + "%";
        spreadRange.addEventListener("input", () => {
            knifeOptions.spread = parseInt(spreadRange.value) / 100;
            spreadVal.textContent = spreadRange.value + "%";
            if (knifeLoopPreview) knifeLoopPreview.spread = knifeOptions.spread;
            drawOverlay();
        });
        spreadRow.append(spreadLbl, spreadRange, spreadVal);
        group.appendChild(spreadRow);

        const snapRow = document.createElement("label");
        snapRow.className = "option-row";
        const snapCheck = document.createElement("input");
        snapCheck.type = "checkbox";
        snapCheck.checked = knifeOptions.snapVertex;
        snapCheck.addEventListener("change", () => {
            knifeOptions.snapVertex = snapCheck.checked;
        });
        const snapLbl = document.createElement("span");
        snapLbl.className = "option-row-label";
        snapLbl.textContent = "Snap a vértice";
        snapRow.append(snapCheck, snapLbl);
        group.appendChild(snapRow);

        const outsideRow = document.createElement("label");
        outsideRow.className = "option-row";
        const outsideCheck = document.createElement("input");
        outsideCheck.type = "checkbox";
        outsideCheck.checked = knifeOptions.cutOutside;
        outsideCheck.addEventListener("change", () => {
            knifeOptions.cutOutside = outsideCheck.checked;
        });
        const outsideLbl = document.createElement("span");
        outsideLbl.className = "option-row-label";
        outsideLbl.textContent = "Cortar fuera del objeto";
        outsideRow.append(outsideCheck, outsideLbl);
        group.appendChild(outsideRow);

        const closeRow = document.createElement("label");
        closeRow.className = "option-row";
        const closeCheck = document.createElement("input");
        closeCheck.type = "checkbox";
        closeCheck.checked = knifeOptions.closePolyline;
        closeCheck.addEventListener("change", () => {
            knifeOptions.closePolyline = closeCheck.checked;
        });
        const closeLbl = document.createElement("span");
        closeLbl.className = "option-row-label";
        closeLbl.textContent = "Cerrar polilínea";
        closeRow.append(closeCheck, closeLbl);
        group.appendChild(closeRow);

        const help = document.createElement("p");
        help.className = "muted";
        help.style.fontSize = "10px";
        help.style.lineHeight = "1.6";
        help.innerHTML =
            "Clic: añadir punto<br>" +
            "Shift+clic en arista: punto medio<br>" +
            "Ctrl sobre arista: preview loop cut<br>" +
            "Ctrl+clic: aplicar · arrastrar: deslizar<br>" +
            "Enter: confirmar · Esc: cancelar · Backspace: quitar";
        group.appendChild(help);

        container.appendChild(group);
    }

    function renderSelectOptions(container) {
        const group = document.createElement("div");
        group.className = "tool-options-group";

        const heading = document.createElement("div");
        heading.className = "tool-options-heading";
        heading.textContent = "SELECCIÓN";
        group.appendChild(heading);

        const boxRow = document.createElement("label");
        boxRow.className = "option-row";
        const boxCheck = document.createElement("input");
        boxCheck.type = "checkbox";
        boxCheck.checked = toolOptions.select.boxSelect;
        boxCheck.addEventListener("change", () => {
            toolOptions.select.boxSelect = boxCheck.checked;
            setStatus("Box select " + (boxCheck.checked ? "habilitado" : "deshabilitado"));
        });
        const boxLbl = document.createElement("span");
        boxLbl.className = "option-row-label";
        boxLbl.textContent = "Box select";
        boxRow.append(boxCheck, boxLbl);
        group.appendChild(boxRow);

        const modeGroup = document.createElement("div");
        modeGroup.className = "option-radio-group";

        const modeLbl = document.createElement("div");
        modeLbl.style.fontSize = "10px";
        modeLbl.style.color = "var(--muted)";
        modeLbl.style.marginBottom = "4px";
        modeLbl.textContent = "Modo box";
        modeGroup.appendChild(modeLbl);

        ["visible", "all"].forEach(mode => {
            const label = document.createElement("label");
            label.className = "option-row";
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "box-mode-select";
            radio.value = mode;
            radio.checked = toolOptions.select.boxMode === mode;
            radio.addEventListener("change", () => {
                if (radio.checked) toolOptions.select.boxMode = mode;
            });
            const lbl = document.createElement("span");
            lbl.className = "option-row-label";
            lbl.textContent = mode === "visible" ? "Solo visible" : "Todo";
            label.append(radio, lbl);
            modeGroup.appendChild(label);
        });

        group.appendChild(modeGroup);
        container.appendChild(group);
    }

    function renderEditOptions(container) {
        const group = document.createElement("div");
        group.className = "tool-options-group";

        const heading = document.createElement("div");
        heading.className = "tool-options-heading";
        heading.textContent = "MODO EDICIÓN";
        group.appendChild(heading);

        const boxRow = document.createElement("label");
        boxRow.className = "option-row";
        const boxCheck = document.createElement("input");
        boxCheck.type = "checkbox";
        boxCheck.checked = toolOptions.edit.boxSelect;
        boxCheck.addEventListener("change", () => {
            toolOptions.edit.boxSelect = boxCheck.checked;
        });
        const boxLbl = document.createElement("span");
        boxLbl.className = "option-row-label";
        boxLbl.textContent = "Box select";
        boxRow.append(boxCheck, boxLbl);
        group.appendChild(boxRow);

        const modeGroup = document.createElement("div");
        modeGroup.className = "option-radio-group";
        const modeLbl = document.createElement("div");
        modeLbl.style.fontSize = "10px";
        modeLbl.style.color = "var(--muted)";
        modeLbl.style.marginBottom = "4px";
        modeLbl.textContent = "Modo box";
        modeGroup.appendChild(modeLbl);

        ["visible", "all"].forEach(mode => {
            const label = document.createElement("label");
            label.className = "option-row";
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "box-mode-edit";
            radio.value = mode;
            radio.checked = toolOptions.edit.boxMode === mode;
            radio.addEventListener("change", () => {
                if (radio.checked) toolOptions.edit.boxMode = mode;
            });
            const lbl = document.createElement("span");
            lbl.className = "option-row-label";
            lbl.textContent = mode === "visible" ? "Solo visible" : "Todo";
            label.append(radio, lbl);
            modeGroup.appendChild(label);
        });

        group.appendChild(modeGroup);

        const subRow = document.createElement("div");
        subRow.className = "option-number-row";
        const subLbl = document.createElement("label");
        subLbl.textContent = "Subdiv niveles";
        const subIn = document.createElement("input");
        subIn.type = "number";
        subIn.min = "1";
        subIn.max = "3";
        subIn.step = "1";
        subIn.value = modelOptions.subdivLevels;
        subIn.addEventListener("change", () => {
            modelOptions.subdivLevels = Math.max(1, Math.min(3, parseInt(subIn.value) || 1));
        });
        subRow.append(subLbl, subIn);
        group.appendChild(subRow);

        container.appendChild(group);
    }

    function renderNoOptions(container, toolName, description) {
        const group = document.createElement("div");
        group.className = "tool-options-group";

        const heading = document.createElement("div");
        heading.className = "tool-options-heading";
        heading.textContent = toolName.toUpperCase();
        group.appendChild(heading);

        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = description;
        group.appendChild(p);

        container.appendChild(group);
    }


    // ======================================
    // OVERLAY 2D
    // ======================================

    function resizeOverlay() {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        overlay.width = Math.max(1, Math.floor(rect.width * dpr));
        overlay.height = Math.max(1, Math.floor(rect.height * dpr));
        overlay.style.width = rect.width + "px";
        overlay.style.height = rect.height + "px";
        overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function clearOverlay() {
        overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    }

    function drawScreenPoint(x, y, radius, color) {
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, radius, 0, Math.PI * 2);
        overlayCtx.fillStyle = color;
        overlayCtx.fill();
        overlayCtx.lineWidth = 1.5;
        overlayCtx.strokeStyle = "#ffffff";
        overlayCtx.stroke();
    }

    function drawScreenLine(x1, y1, x2, y2, color, dashed) {
        overlayCtx.beginPath();
        if (dashed) overlayCtx.setLineDash([5, 4]);
        else overlayCtx.setLineDash([]);
        overlayCtx.moveTo(x1, y1);
        overlayCtx.lineTo(x2, y2);
        overlayCtx.strokeStyle = color;
        overlayCtx.lineWidth = 2;
        overlayCtx.stroke();
        overlayCtx.setLineDash([]);
    }

    function drawScreenText(text, x, y, color, size) {
        overlayCtx.font = "bold " + (size || 12) + "px -apple-system, 'Segoe UI', sans-serif";
        overlayCtx.fillStyle = color;
        overlayCtx.strokeStyle = "rgba(0,0,0,0.7)";
        overlayCtx.lineWidth = 3;
        overlayCtx.strokeText(text, x, y);
        overlayCtx.fillText(text, x, y);
    }

    function drawOverlay() {
        clearOverlay();
        if (!knifeActive) return;

        const obj = getEditObject() || getSelected();
        if (!obj) return;

        const vp = computeViewProjection();

        const loopPrev = knifeLoopPreview || hoverLoopPreview;
        if (loopPrev) {
            const segments = computeLoopCutPreviewSegments(obj, loopPrev);
            for (const [p1, p2] of segments) {
                const w1 = objectToWorld(obj, p1);
                const w2 = objectToWorld(obj, p2);
                const s1 = projectToScreen(w1, vp);
                const s2 = projectToScreen(w2, vp);
                if (!s1 || !s2) continue;
                drawScreenLine(s1[0], s1[1], s2[0], s2[1], "#f2b545", false);
                drawScreenPoint(s1[0], s1[1], 3, "#f2b545");
                drawScreenPoint(s2[0], s2[1], 3, "#f2b545");
            }

            const posText = loopPrev.count === 1
                ? Math.round(loopPrev.position * 100) + "%"
                : "spread " + Math.round(loopPrev.spread * 100) + "%";

            drawScreenText(
                "Loop cut · " + loopPrev.count + " cortes · " + posText + " · clic para aplicar",
                12, 22, "#f2b545", 12
            );
            return;
        }

        knifePoints.forEach((pt, i) => {
            const world = objectToWorld(obj, pt.localPoint);
            const s = projectToScreen(world, vp);
            if (!s) return;
            drawScreenPoint(s[0], s[1], 6, "#4cd48a");
            drawScreenText(String(i + 1), s[0] + 10, s[1] - 10, "#4cd48a", 12);
        });

        if (knifeHover) {
            const world = objectToWorld(obj, knifeHover.localPoint);
            const s = projectToScreen(world, vp);
            if (s) {
                if (knifeHover.kind === "vertex") {
                    drawScreenPoint(s[0], s[1], 8, "#4cd48a");
                    drawScreenText("vértice", s[0] + 12, s[1] - 12, "#4cd48a", 11);
                } else if (knifeHover.kind === "edge") {
                    drawScreenPoint(s[0], s[1], 6, "#5ba8ff");
                    drawScreenText("arista", s[0] + 12, s[1] - 12, "#5ba8ff", 11);
                } else if (knifeHover.kind === "face") {
                    drawScreenPoint(s[0], s[1], 5, "#f2b545");
                } else {
                    drawScreenPoint(s[0], s[1], 5, "#e05656");
                    drawScreenText("fuera", s[0] + 12, s[1] - 12, "#e05656", 11);
                }
            }
        }

        for (let i = 0; i < knifePoints.length - 1; i++) {
            const a = objectToWorld(obj, knifePoints[i].localPoint);
            const b = objectToWorld(obj, knifePoints[i + 1].localPoint);
            const sa = projectToScreen(a, vp);
            const sb = projectToScreen(b, vp);
            if (!sa || !sb) continue;
            drawScreenLine(sa[0], sa[1], sb[0], sb[1], "#4cd48a", false);
        }

        if (knifePoints.length > 0 && knifeHover) {
            const last = knifePoints[knifePoints.length - 1];
            const a = objectToWorld(obj, last.localPoint);
            const b = objectToWorld(obj, knifeHover.localPoint);
            const sa = projectToScreen(a, vp);
            const sb = projectToScreen(b, vp);
            if (sa && sb) drawScreenLine(sa[0], sa[1], sb[0], sb[1], "#4cd48a", true);
        }

        let statusText = "Knife · clic para añadir punto";
        if (knifePoints.length > 0) {
            statusText = "Knife · " + knifePoints.length + " punto(s) · Enter confirmar · Esc cancelar · Backspace quitar";
        }
        drawScreenText(statusText, 12, 22, "#4cd48a", 12);
    }

    function computeLoopCutPreviewSegments(obj, preview) {
        const mesh = obj.mesh;
        const ring = MeshOps.loopRing(mesh, preview.edgeIndex);
        if (!ring) return [];
        const tValues = MeshOps.loopCutTValues(preview.position, preview.count, preview.spread);
        const lerp = (l, t) => Vector3.lerp(mesh.vertices[l.s], mesh.vertices[l.e], t);

        const segments = [];
        for (const f of ring.faces) {
            const l1 = ring.laterals.get(f.k1);
            const l2 = ring.laterals.get(f.k2);
            for (const t of tValues) segments.push([lerp(l1, t), lerp(l2, t)]);
        }
        return segments;
    }


    // ======================================
    // PICK DEL KNIFE
    // ======================================

    function pickKnifePoint(mouseX, mouseY, modifiers) {
        const obj = getEditObject() || getSelected();
        if (!obj) return null;

        const vp = computeViewProjection();
        const rect = canvas.getBoundingClientRect();
        const px = ((mouseX - rect.left) / rect.width) * canvas.width;
        const py = ((mouseY - rect.top) / rect.height) * canvas.height;
        const mesh = obj.mesh;

        if (knifeOptions.snapVertex && !modifiers.ctrl) {
            let bestIdx = -1, bestDist = Infinity;
            const THRESHOLD = 14 * (canvas.width / rect.width);
            for (let i = 0; i < mesh.vertices.length; i++) {
                const world = objectToWorld(obj, mesh.vertices[i]);
                const s = projectToScreen(world, vp);
                if (!s) continue;
                const d = Math.hypot(s[0] - px, s[1] - py);
                if (d < THRESHOLD && d < bestDist) { bestDist = d; bestIdx = i; }
            }
            if (bestIdx >= 0) {
                return { kind: "vertex", index: bestIdx, localPoint: [...mesh.vertices[bestIdx]] };
            }
        }

        {
            const edges = MeshOps.edges(mesh);
            let bestIdx = -1, bestDist = Infinity, bestT = 0;
            const THRESHOLD = 12 * (canvas.width / rect.width);
            for (let i = 0; i < edges.length; i++) {
                const [ia, ib] = edges[i];
                const wa = objectToWorld(obj, mesh.vertices[ia]);
                const wb = objectToWorld(obj, mesh.vertices[ib]);
                const sa = projectToScreen(wa, vp);
                const sb = projectToScreen(wb, vp);
                if (!sa || !sb) continue;
                const dx = sb[0] - sa[0], dy = sb[1] - sa[1];
                const lenSq = dx*dx + dy*dy;
                if (lenSq < 1e-6) continue;
                let t = ((px - sa[0]) * dx + (py - sa[1]) * dy) / lenSq;
                t = Math.max(0, Math.min(1, t));
                const cx = sa[0] + dx * t;
                const cy = sa[1] + dy * t;
                const d = Math.hypot(px - cx, py - cy);
                if (d < THRESHOLD && d < bestDist) {
                    bestDist = d;
                    bestIdx = i;
                    bestT = t;
                }
            }
            if (bestIdx >= 0) {
                const [ia, ib] = edges[bestIdx];
                const va = mesh.vertices[ia];
                const vb = mesh.vertices[ib];
                const useMid = modifiers.shift && !modifiers.ctrl;
                const t = useMid ? 0.5 : bestT;
                const p = [
                    va[0] + (vb[0]-va[0]) * t,
                    va[1] + (vb[1]-va[1]) * t,
                    va[2] + (vb[2]-va[2]) * t
                ];
                return { kind: "edge", index: bestIdx, localPoint: p, t, edgeIndex: bestIdx };
            }
        }

        {
            const ray = Raycast.rayFromScreen(canvas, camera, mouseX, mouseY);
            const hit = Raycast.pickObjects([obj], ray);
            if (hit) {
                const local = worldToLocal(obj, hit.point);
                return { kind: "face", index: hit.faceIndex, localPoint: local };
            }
        }

        if (knifeOptions.cutOutside) {
            const ray = Raycast.rayFromScreen(canvas, camera, mouseX, mouseY);
            const center = objectWorldCenter(obj);
            const camPos = camera.position;
            const dir = Vector3.normalize(Vector3.subtract(camera.target, camPos));
            const denom = Vector3.dot(ray.direction, dir);
            if (Math.abs(denom) > 1e-6) {
                const t = Vector3.dot(Vector3.subtract(center, ray.origin), dir) / denom;
                if (t > 0) {
                    const worldHit = [
                        ray.origin[0] + ray.direction[0] * t,
                        ray.origin[1] + ray.direction[1] * t,
                        ray.origin[2] + ray.direction[2] * t
                    ];
                    const local = worldToLocal(obj, worldHit);
                    return { kind: "outside", index: -1, localPoint: local };
                }
            }
        }

        return null;
    }

    function edgeMouseT(obj, edgeIndex, mouseX, mouseY) {
        const edge = MeshOps.edgeFromIndex(obj.mesh, edgeIndex);
        if (!edge) return null;
        const vp = computeViewProjection();
        const rect = canvas.getBoundingClientRect();
        const px = ((mouseX - rect.left) / rect.width) * canvas.width;
        const py = ((mouseY - rect.top) / rect.height) * canvas.height;
        const sa = projectToScreen(objectToWorld(obj, obj.mesh.vertices[edge[0]]), vp);
        const sb = projectToScreen(objectToWorld(obj, obj.mesh.vertices[edge[1]]), vp);
        if (!sa || !sb) return null;
        const dx = sb[0] - sa[0], dy = sb[1] - sa[1];
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1e-6) return null;
        return Math.max(0, Math.min(1, ((px - sa[0]) * dx + (py - sa[1]) * dy) / lenSq));
    }

    function loopPositionFromMouse(t, shift) {
        if (!knifeOptions.followMouse || t === null || t === undefined) return knifeOptions.position;
        const p = shift ? Math.round(t * 10) / 10 : t;
        return Math.max(0.05, Math.min(0.95, p));
    }

    function updateKnifeHover(x, y, ctrl, shift) {
        const pick = pickKnifePoint(x, y, { shift, ctrl });
        knifeHover = pick;
        if (ctrl && pick && pick.kind === "edge") {
            hoverLoopPreview = {
                edgeIndex: pick.edgeIndex,
                position: loopPositionFromMouse(pick.t, shift),
                count: knifeOptions.count,
                spread: knifeOptions.spread
            };
        } else {
            hoverLoopPreview = null;
        }
        drawOverlay();
    }


    // ======================================
    // MODO KNIFE
    // ======================================

    function enterKnifeMode() {
        if (!getSelected() && !getEditObject()) {
            setStatus("Selecciona un objeto primero para usar el Knife");
            return;
        }
        if (!editMode) {
            enterEditMode();
            if (!editMode) return;
        }
        knifeActive = true;
        knifePoints = [];
        knifeHover = null;
        knifeLoopPreview = null;
        hoverLoopPreview = null;
        viewport.classList.add("knife-active");
        setTool("select");
        updateToolOptions();
        refreshToolsGrid();
        setStatus("KNIFE · clic para añadir punto · Esc cancelar");
        render();
    }

    function exitKnifeMode() {
        knifeActive = false;
        knifePoints = [];
        knifeHover = null;
        knifeLoopPreview = null;
        hoverLoopPreview = null;
        viewport.classList.remove("knife-active");
        updateToolOptions();
        refreshToolsGrid();
        setStatus("Knife desactivado");
        render();
    }

    function confirmKnife() {
        if (!knifeActive) return;

        const obj = getEditObject() || getSelected();
        if (!obj) return;

        if (knifeLoopPreview) {
            pushHistory();
            const ok = MeshOps.loopCutFromEdge(
                obj.mesh,
                knifeLoopPreview.edgeIndex,
                knifeLoopPreview.position,
                knifeLoopPreview.count,
                knifeLoopPreview.spread
            );
            if (ok) {
                setStatus("Loop cut aplicado: " + knifeLoopPreview.count + " cortes");
            } else {
                setStatus("No se pudo aplicar el loop cut");
            }
            knifeLoopPreview = null;
            hoverLoopPreview = null;
            knifePoints = [];
            knifeHover = null;
            render();
            updateProperties();
            return;
        }

        if (knifePoints.length < 2) {
            setStatus("Necesitas al menos 2 puntos para cortar");
            return;
        }

        const pts = knifePoints.map(p => p.localPoint);
        if (knifeOptions.closePolyline) {
            pts.push(knifePoints[0].localPoint);
        }

        pushHistory();
        let count = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            const ok = MeshOps.knifeCutSegment(obj.mesh, pts[i], pts[i + 1]);
            if (ok) count++;
        }

        if (count > 0) {
            setStatus("Knife aplicado: " + count + " tramo(s)");
            MeshOps.compactMesh(obj.mesh);
        } else {
            setStatus("Knife: no se pudo aplicar ningún corte");
        }

        knifePoints = [];
        knifeHover = null;
        render();
        updateProperties();
        updateOutliner();
    }


    // ======================================
    // RENDER
    // ======================================

    function render() {
        updateCamera();
        let gizmoMode = null;
        let activeAxis = null;
        let gizmoObject = null;

        if (!editMode) {
            if (selectedGroupId !== null) {
                const g = getGroup(selectedGroupId);
                if (g && (currentTool === "move" || currentTool === "rotate" || currentTool === "scale")) {
                    gizmoMode = currentTool;
                    activeAxis = groupTransform ? groupTransform.axis : null;
                    gizmoObject = {
                        position: g.pivot || [0, 0, 0],
                        rotation: [0, 0, 0],
                        scale: [1, 1, 1],
                        pivot: [0, 0, 0]
                    };
                }
            } else if (selectedId !== null) {
                const selected = getSelected();
                if (selected && (currentTool === "move" || currentTool === "rotate" || currentTool === "scale")) {
                    gizmoMode = currentTool;
                    activeAxis = multiTransform ? multiTransform.axis : (transform ? transform.axis : null);
                    gizmoObject = selected;
                }
            }
        }

        const editData = editMode && editObjectId !== null
            ? {
                objectId: editObjectId,
                selection: editSelection,
                currentTool,
                activeAxis: editTransform ? editTransform.axis : null
            }
            : null;

        const visibleObjects = objects.filter(o => isObjectVisible(o));

        let renderObjects = visibleObjects;
        if (gizmoObject && selectedGroupId !== null) {
            renderObjects = visibleObjects.concat([{
                id: "__group_gizmo__",
                position: gizmoObject.position,
                rotation: gizmoObject.rotation,
                scale: gizmoObject.scale,
                pivot: gizmoObject.pivot,
                mesh: { vertices: [], faces: [], color: [0,0,0], version: 0 },
                color: [0,0,0],
                visible: false
            }]);
        }

        const selectedForRenderer = selectedGroupId !== null ? "__group_gizmo__" : selectedId;

        renderer.render(renderObjects, camera, selectedIds, selectedForRenderer,
                        gizmoMode, activeAxis, editData, viewMode, smoothLevel,
                        hoverGizmo ? hoverGizmo.axis : null);
        renderer.pruneMeshCache(objects);

        $("objectCount").textContent = objects.length + " objetos";
        $("emptyMessage").style.display = objects.length === 0 ? "grid" : "none";

        const header = document.querySelector(".viewport-header > span");
        if (header) {
            if (knifeActive) {
                header.innerHTML = 'VIEWPORT <span class="muted">/ KNIFE · Enter confirmar · Esc cancelar</span>';
            } else if (editMode) {
                header.innerHTML = 'VIEWPORT <span class="muted">/ MODO EDICIÓN · Tab para salir</span>';
            } else {
                header.innerHTML = 'VIEWPORT <span class="muted">/ SOLID · Tab → Modo Edición</span>';
            }
        }

        drawOverlay();
    }

    function setStatus(msg) { $("status").textContent = msg; }
    function axisName(axis) {
        if (axis === 0) return "X";
        if (axis === 1) return "Y";
        if (axis === 2) return "Z";
        return "libre";
    }
    function viewModeName(mode) {
        if (mode === "solid") return "Normal (1)";
        if (mode === "solid-wire") return "Smooth + Cage (2) — nivel " + smoothLevel;
        if (mode === "smooth") return "Smooth (3) — nivel " + smoothLevel;
        return mode;
    }
    function setViewMode(mode) {
        viewMode = mode;
        setStatus("Vista: " + viewModeName(mode));
        render();
        updateProperties();
    }


    function setTool(tool) {
        currentTool = tool;
        document.querySelectorAll(".rail-btn[data-tool]").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.tool === tool);
        });
        setStatus("Herramienta: " + tool);
        updateToolOptions();
        render();
    }
    document.querySelectorAll(".rail-btn[data-tool]").forEach(btn => {
        btn.addEventListener("click", () => setTool(btn.dataset.tool));
    });


    function focusSelected() {
        if (editMode && editSelection && editSelectionCount() > 0) {
            const obj = getEditObject();
            if (!obj) return;
            let targetLocal = null;
            if (editSelection.vertices.size > 0) {
                const first = editSelection.vertices.values().next().value;
                targetLocal = [...obj.mesh.vertices[first]];
            } else if (editSelection.edges.size > 0) {
                const first = editSelection.edges.values().next().value;
                const edge = MeshOps.edgeFromIndex(obj.mesh, first);
                if (edge) {
                    const a = obj.mesh.vertices[edge[0]];
                    const b = obj.mesh.vertices[edge[1]];
                    targetLocal = [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2];
                }
            } else if (editSelection.faces.size > 0) {
                const first = editSelection.faces.values().next().value;
                targetLocal = MeshOps.faceCenter(obj.mesh, first);
            }
            if (targetLocal) {
                const world = objectToWorld(obj, targetLocal);
                camera.target = world;
                camera.radius = Math.max(1.5, Math.max(...obj.scale) * 1.5);
                render();
                return;
            }
        }
        if (selectedGroupId !== null) {
            const g = getGroup(selectedGroupId);
            if (g) {
                camera.target = [...(g.pivot || [0,0,0])];
                camera.radius = Math.max(3, camera.radius);
                render();
                return;
            }
        }

        const selObjs = objects.filter(o => selectedIds.has(o.id));
        if (selObjs.length === 0) return;
        const aabb = aabbOfObjects(selObjs);
        if (!aabb) return;
        const cx = (aabb.min[0] + aabb.max[0]) / 2;
        const cy = (aabb.min[1] + aabb.max[1]) / 2;
        const cz = (aabb.min[2] + aabb.max[2]) / 2;
        const sizeX = aabb.max[0] - aabb.min[0];
        const sizeY = aabb.max[1] - aabb.min[1];
        const sizeZ = aabb.max[2] - aabb.min[2];
        const diagonal = Math.hypot(sizeX, sizeY, sizeZ) || 1;
        camera.target = [cx, cy, cz];
        camera.radius = Math.max(3, diagonal * 1.4);
        render();
    }


    function pixelsToWorldAtPoint(worldPoint) {
        const dist = Math.hypot(
            camera.position[0] - worldPoint[0],
            camera.position[1] - worldPoint[1],
            camera.position[2] - worldPoint[2]
        ) || camera.radius;
        const fov = 55 * Math.PI / 180;
        const heightPx = canvas.clientHeight || 1;
        return (2 * dist * Math.tan(fov / 2)) / heightPx;
    }

    function applyRotationAroundAxis(object, axisWorld, angleRad) {
        const [rx, ry, rz] = object.rotation.map(v => v * Math.PI / 180);
        const cx = Math.cos(rx), sx = Math.sin(rx);
        const cy = Math.cos(ry), sy = Math.sin(ry);
        const cz = Math.cos(rz), sz = Math.sin(rz);
        const R = [
            [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
            [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
            [-sy,     cy * sx,                cy * cx]
        ];
        const localAxis = [
            R[0][0] * axisWorld[0] + R[1][0] * axisWorld[1] + R[2][0] * axisWorld[2],
            R[0][1] * axisWorld[0] + R[1][1] * axisWorld[1] + R[2][1] * axisWorld[2],
            R[0][2] * axisWorld[0] + R[1][2] * axisWorld[1] + R[2][2] * axisWorld[2]
        ];
        object.rotation[0] += localAxis[0] * angleRad * 180 / Math.PI;
        object.rotation[1] -= localAxis[1] * angleRad * 180 / Math.PI;
        object.rotation[2] += localAxis[2] * angleRad * 180 / Math.PI;
    }

    function beginTransform(tool, axis = null) {
        const object = getSelected();
        if (!object) { setStatus("Selecciona un objeto primero"); return; }
        transform = {
            tool, object,
            origin: {
                position: [...object.position],
                rotation: [...object.rotation],
                scale: [...object.scale]
            },
            axis
        };
        setTool(tool);
        const label = tool === "move" ? "MOVIENDO" : tool === "rotate" ? "ROTANDO" : "ESCALANDO";
        setStatus(label + ": " + axisName(axis));
    }

    function beginMultiTransform(tool, axis = null) {
        const lastSel = getLastSelected();
        if (!lastSel) return;
        const origins = {};
        const pivots = {};
        selectedIds.forEach(id => {
            const o = objects.find(ob => ob.id === id);
            if (o) {
                origins[id] = {
                    position: [...o.position],
                    rotation: [...o.rotation],
                    scale: [...o.scale]
                };
                pivots[id] = objectWorldPivot(o);
            }
        });
        multiTransform = {
            tool,
            lastId: lastSel.id,
            origin: { objects: origins },
            pivots,
            axis
        };
        setTool(tool);
        const label = tool === "move" ? "MOVIENDO" : tool === "rotate" ? "ROTANDO" : "ESCALANDO";
        setStatus(label + " (" + selectedIds.size + " objetos)");
    }

    function beginGroupTransform(tool, axis = null) {
        const g = getGroup(selectedGroupId);
        if (!g) { setStatus("Selecciona un grupo primero"); return; }
        const origins = {};
        g.objectIds.forEach(oid => {
            const o = objects.find(ob => ob.id === oid);
            if (o) {
                origins[oid] = {
                    position: [...o.position],
                    rotation: [...o.rotation],
                    scale: [...o.scale]
                };
            }
        });
        groupTransform = {
            tool, group: g,
            origin: {
                pivot: [...(g.pivot || [0, 0, 0])],
                objects: origins
            },
            axis
        };
        const label = tool === "move" ? "MOVIENDO GRUPO" : tool === "rotate" ? "ROTANDO GRUPO" : "ESCALANDO GRUPO";
        setStatus(label);
    }

    function finishTransform(cancel = false) {
        if (transform) {
            if (cancel) {
                const o = transform.object;
                o.position = transform.origin.position;
                o.rotation = transform.origin.rotation;
                o.scale = transform.origin.scale;
            }
            transform = null;
        }
        if (multiTransform) {
            if (cancel) {
                selectedIds.forEach(id => {
                    const o = objects.find(ob => ob.id === id);
                    const orig = multiTransform.origin.objects[id];
                    if (o && orig) {
                        o.position = [...orig.position];
                        o.rotation = [...orig.rotation];
                        o.scale = [...orig.scale];
                    }
                });
            }
            multiTransform = null;
        }
        if (groupTransform) {
            if (cancel) {
                const g = groupTransform.group;
                g.pivot = groupTransform.origin.pivot;
                g.objectIds.forEach(oid => {
                    const o = objects.find(ob => ob.id === oid);
                    const orig = groupTransform.origin.objects[oid];
                    if (o && orig) {
                        o.position = [...orig.position];
                        o.rotation = [...orig.rotation];
                        o.scale = [...orig.scale];
                    }
                });
            }
            groupTransform = null;
        }
        updateProperties();
        render();
        setStatus(cancel ? "Transformación cancelada" : "Transformación confirmada");
    }

    function rotatePointAroundAxis(point, pivot, axis, angleRad) {
        const v = [point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]];
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        const cross = [
            axis[1]*v[2] - axis[2]*v[1],
            axis[2]*v[0] - axis[0]*v[2],
            axis[0]*v[1] - axis[1]*v[0]
        ];
        const crossCross = [
            axis[1]*cross[2] - axis[2]*cross[1],
            axis[2]*cross[0] - axis[0]*cross[2],
            axis[0]*cross[1] - axis[1]*cross[0]
        ];
        return [
            pivot[0] + v[0] + sinA * cross[0] + (1 - cosA) * crossCross[0],
            pivot[1] + v[1] + sinA * cross[1] + (1 - cosA) * crossCross[1],
            pivot[2] + v[2] + sinA * cross[2] + (1 - cosA) * crossCross[2]
        ];
    }

    function applyTransform(dx, dy) {
        const basis = cameraBasis();

        if (multiTransform) {
            const tool = multiTransform.tool;
            const axis = multiTransform.axis;

            if (tool === "move") {
                const lastPivot = multiTransform.pivots[multiTransform.lastId] || [0,0,0];
                const k = pixelsToWorldAtPoint(lastPivot);
                const deltaWorld = Vector3.add(
                    Vector3.multiply(basis.right, dx * k),
                    Vector3.multiply(basis.up, -dy * k)
                );
                let finalDelta = deltaWorld;
                if (axis !== null) {
                    const axisVec = axis === 0 ? [1,0,0] : axis === 1 ? [0,1,0] : [0,0,1];
                    const amount = Vector3.dot(deltaWorld, axisVec);
                    finalDelta = Vector3.multiply(axisVec, amount);
                }
                selectedIds.forEach(id => {
                    const o = objects.find(ob => ob.id === id);
                    const orig = multiTransform.origin.objects[id];
                    if (o && orig) {
                        o.position = Vector3.add(orig.position, finalDelta);
                    }
                });
            } else if (tool === "rotate") {
                let axisWorld;
                if (axis !== null) axisWorld = axis === 0 ? [1,0,0] : axis === 1 ? [0,1,0] : [0,0,1];
                else axisWorld = basis.forward;
                const angle = -dx * 0.01;
                selectedIds.forEach(id => {
                    const o = objects.find(ob => ob.id === id);
                    const orig = multiTransform.origin.objects[id];
                    if (o && orig) {
                        const temp = { rotation: orig.rotation.slice() };
                        applyRotationAroundAxis(temp, axisWorld, angle);
                        o.rotation = temp.rotation;
                        o.position = [...orig.position];
                    }
                });
            } else if (tool === "scale") {
                const amount = (dx - dy) * 0.005;
                let factorX = 1, factorY = 1, factorZ = 1;
                if (axis !== null) {
                    if (axis === 0) factorX = Math.max(0.01, 1 + amount);
                    if (axis === 1) factorY = Math.max(0.01, 1 + amount);
                    if (axis === 2) factorZ = Math.max(0.01, 1 + amount);
                } else {
                    const f = Math.max(0.01, 1 + amount);
                    factorX = factorY = factorZ = f;
                }
                selectedIds.forEach(id => {
                    const o = objects.find(ob => ob.id === id);
                    const orig = multiTransform.origin.objects[id];
                    if (o && orig) {
                        o.scale = [
                            orig.scale[0] * factorX,
                            orig.scale[1] * factorY,
                            orig.scale[2] * factorZ
                        ];
                        o.position = [...orig.position];
                    }
                });
            }
            updateProperties();
            render();
            return;
        }

        if (groupTransform) {
            const g = groupTransform.group;
            const tool = groupTransform.tool;
            const axis = groupTransform.axis;
            const originPivot = groupTransform.origin.pivot;
            const k = pixelsToWorldAtPoint(originPivot);

            if (tool === "move") {
                const deltaWorld = Vector3.add(
                    Vector3.multiply(basis.right, dx * k),
                    Vector3.multiply(basis.up, -dy * k)
                );
                let finalDelta = deltaWorld;
                if (axis !== null) {
                    const axisVec = axis === 0 ? [1,0,0] : axis === 1 ? [0,1,0] : [0,0,1];
                    const amount = Vector3.dot(deltaWorld, axisVec);
                    finalDelta = Vector3.multiply(axisVec, amount);
                }
                g.pivot = Vector3.add(originPivot, finalDelta);
                g.objectIds.forEach(oid => {
                    const o = objects.find(ob => ob.id === oid);
                    const orig = groupTransform.origin.objects[oid];
                    if (o && orig) {
                        o.position = Vector3.add(orig.position, finalDelta);
                    }
                });
            }
            if (tool === "rotate") {
                let axisWorld;
                if (axis !== null) axisWorld = axis === 0 ? [1,0,0] : axis === 1 ? [0,1,0] : [0,0,1];
                else axisWorld = basis.forward;
                const angle = -dx * 0.01;
                g.objectIds.forEach(oid => {
                    const o = objects.find(ob => ob.id === oid);
                    const orig = groupTransform.origin.objects[oid];
                    if (o && orig) {
                        const rel = Vector3.subtract(orig.position, originPivot);
                        o.position = rotatePointAroundAxis(
                            Vector3.add(originPivot, rel),
                            originPivot,
                            axisWorld,
                            angle
                        );
                        const temp = { rotation: orig.rotation.slice() };
                        applyRotationAroundAxis(temp, axisWorld, angle);
                        o.rotation = temp.rotation;
                    }
                });
            }
            if (tool === "scale") {
                const amount = (dx - dy) * 0.005;
                let factorX = 1, factorY = 1, factorZ = 1;
                if (axis !== null) {
                    if (axis === 0) factorX = Math.max(0.01, 1 + amount);
                    if (axis === 1) factorY = Math.max(0.01, 1 + amount);
                    if (axis === 2) factorZ = Math.max(0.01, 1 + amount);
                } else {
                    const f = Math.max(0.01, 1 + amount);
                    factorX = factorY = factorZ = f;
                }
                g.objectIds.forEach(oid => {
                    const o = objects.find(ob => ob.id === oid);
                    const orig = groupTransform.origin.objects[oid];
                    if (o && orig) {
                        const rel = Vector3.subtract(orig.position, originPivot);
                        o.position = [
                            originPivot[0] + rel[0] * factorX,
                            originPivot[1] + rel[1] * factorY,
                            originPivot[2] + rel[2] * factorZ
                        ];
                        o.scale = [
                            orig.scale[0] * factorX,
                            orig.scale[1] * factorY,
                            orig.scale[2] * factorZ
                        ];
                    }
                });
            }
            updateProperties();
            render();
            return;
        }

        if (!transform) return;
        const object = transform.object;
        const tool = transform.tool;
        const axis = transform.axis;
        const k = pixelsToWorldAtPoint(objectWorldCenter(object));
        if (tool === "move") {
            const deltaWorld = Vector3.add(
                Vector3.multiply(basis.right, dx * k),
                Vector3.multiply(basis.up, -dy * k)
            );
            let finalDelta = deltaWorld;
            if (axis !== null) {
                const axisVec = axis === 0 ? [1,0,0] : axis === 1 ? [0,1,0] : [0,0,1];
                const amount = Vector3.dot(deltaWorld, axisVec);
                finalDelta = Vector3.multiply(axisVec, amount);
            }
            object.position = Vector3.add(transform.origin.position, finalDelta);
        }
        if (tool === "rotate") {
            object.rotation = [...transform.origin.rotation];
            const angle = -dx * 0.01;
            const temp = { rotation: transform.origin.rotation.slice() };
            if (axis !== null) {
                const axisVec = axis === 0 ? [1,0,0] : axis === 1 ? [0,1,0] : [0,0,1];
                applyRotationAroundAxis(temp, axisVec, angle);
            } else {
                applyRotationAroundAxis(temp, basis.forward, angle);
            }
            object.rotation = temp.rotation;
        }
        if (tool === "scale") {
            object.scale = [...transform.origin.scale];
            const amount = (dx - dy) * 0.005;
            if (axis !== null) {
                object.scale[axis] = Math.max(0.01, transform.origin.scale[axis] + amount);
            } else {
                const factor = Math.max(0.01, 1 + amount);
                object.scale = transform.origin.scale.map(v => Math.max(0.01, v * factor));
            }
        }
        updateProperties();
        render();
    }


    // ======================================
    // MODO EDICIÓN
    // ======================================

    function newEditSelection(mode) {
        return {
            mode: mode || "vertex",
            vertices: new Set(),
            edges: new Set(),
            faces: new Set()
        };
    }

    function enterEditMode() {
        const obj = getSelected();
        if (!obj) { setStatus("Selecciona un objeto antes de entrar en modo edición"); return; }
        editMode = true;
        editObjectId = obj.id;
        editSelection = newEditSelection("vertex");
        viewport.classList.add("edit-mode");
        setTool("select");
        updateToolOptions();
        refreshToolsGrid();
        setStatus("MODO EDICIÓN · 1=vert 2=arista 3=cara · Tab=salir");
        render();
        updateProperties();
    }

    function exitEditMode() {
        editMode = false;
        editObjectId = null;
        editSelection = null;
        editTransform = null;
        if (knifeActive) exitKnifeMode();
        viewport.classList.remove("edit-mode");
        updateToolOptions();
        refreshToolsGrid();
        setStatus("Modo objeto");
        render();
        updateProperties();
    }

    function toggleEditMode() {
        if (editMode) exitEditMode();
        else enterEditMode();
    }

    function editSelectionCount() {
        if (!editSelection) return 0;
        if (editSelection.mode === "vertex") return editSelection.vertices.size;
        if (editSelection.mode === "edge") return editSelection.edges.size;
        return editSelection.faces.size;
    }

    function setEditSubMode(mode) {
        if (!editMode) return;
        if (!editSelection) editSelection = newEditSelection(mode);
        editSelection.mode = mode;
        editSelection.vertices.clear();
        editSelection.edges.clear();
        editSelection.faces.clear();
        setStatus("Selección de " + (mode === "vertex" ? "vértices" : mode === "edge" ? "aristas" : "caras"));
        render();
        updateProperties();
    }


    function pickEditElement(mouseX, mouseY) {
        const obj = getEditObject();
        if (!obj || !editSelection) return null;
        const mode = editSelection.mode;
        const vp = computeViewProjection();
        const rect = canvas.getBoundingClientRect();
        const px = ((mouseX - rect.left) / rect.width) * canvas.width;
        const py = ((mouseY - rect.top) / rect.height) * canvas.height;
        const mesh = obj.mesh;

        if (mode === "vertex") {
            let bestIdx = -1, bestDist = Infinity;
            const THRESHOLD = 12 * (canvas.width / rect.width);
            for (let i = 0; i < mesh.vertices.length; i++) {
                const world = objectToWorld(obj, mesh.vertices[i]);
                const screen = projectToScreen(world, vp);
                if (!screen) continue;
                const d = Math.hypot(screen[0] - px, screen[1] - py);
                if (d < THRESHOLD && d < bestDist) { bestDist = d; bestIdx = i; }
            }
            return bestIdx >= 0 ? { kind: "vertex", index: bestIdx } : null;
        }
        if (mode === "edge") {
            const edges = MeshOps.edges(mesh);
            let bestIdx = -1, bestDist = Infinity;
            const THRESHOLD = 10 * (canvas.width / rect.width);
            for (let i = 0; i < edges.length; i++) {
                const [ia, ib] = edges[i];
                const wa = objectToWorld(obj, mesh.vertices[ia]);
                const wb = objectToWorld(obj, mesh.vertices[ib]);
                const sa = projectToScreen(wa, vp);
                const sb = projectToScreen(wb, vp);
                if (!sa || !sb) continue;
                const dx = sb[0] - sa[0], dy = sb[1] - sa[1];
                const lenSq = dx * dx + dy * dy;
                if (lenSq < 1e-6) continue;
                let t = ((px - sa[0]) * dx + (py - sa[1]) * dy) / lenSq;
                t = Math.max(0, Math.min(1, t));
                const cx = sa[0] + dx * t;
                const cy = sa[1] + dy * t;
                const d = Math.hypot(px - cx, py - cy);
                if (d < THRESHOLD && d < bestDist) { bestDist = d; bestIdx = i; }
            }
            return bestIdx >= 0 ? { kind: "edge", index: bestIdx } : null;
        }
        if (mode === "face") {
            const ray = Raycast.rayFromScreen(canvas, camera, mouseX, mouseY);
            const hit = Raycast.pickObjects([obj], ray);
            return hit ? { kind: "face", index: hit.faceIndex } : null;
        }
        return null;
    }


    function isPointVisible(obj, localPoint) {
        const world = objectToWorld(obj, localPoint);
        const origin = [...camera.position];
        const dir = Vector3.normalize(Vector3.subtract(world, origin));
        const pointDist = Math.hypot(
            world[0] - origin[0],
            world[1] - origin[1],
            world[2] - origin[2]
        );
        const ray = { origin, direction: dir };
        const hit = Raycast.pickObjects([obj], ray);
        if (!hit) return false;
        return hit.distance >= pointDist - 0.05;
    }

    function performBoxSelect(startX, startY, endX, endY, additive, subtractive) {
        const obj = getEditObject();
        if (!obj || !editSelection) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x1 = Math.min(startX, endX);
        const y1 = Math.min(startY, endY);
        const x2 = Math.max(startX, endX);
        const y2 = Math.max(startY, endY);
        const cx1 = (x1 - rect.left) * scaleX;
        const cy1 = (y1 - rect.top) * scaleY;
        const cx2 = (x2 - rect.left) * scaleX;
        const cy2 = (y2 - rect.top) * scaleY;
        const vp = computeViewProjection();
        const mesh = obj.mesh;
        const mode = editSelection.mode;
        const targetSet =
            mode === "vertex" ? editSelection.vertices :
            mode === "edge"   ? editSelection.edges :
                                editSelection.faces;
        if (!additive && !subtractive) targetSet.clear();
        const candidates = [];
        if (mode === "vertex") {
            for (let i = 0; i < mesh.vertices.length; i++) {
                const world = objectToWorld(obj, mesh.vertices[i]);
                const s = projectToScreen(world, vp);
                if (!s) continue;
                if (s[0] >= cx1 && s[0] <= cx2 && s[1] >= cy1 && s[1] <= cy2) {
                    candidates.push({ index: i, localPoint: mesh.vertices[i] });
                }
            }
        } else if (mode === "edge") {
            const edges = MeshOps.edges(mesh);
            for (let i = 0; i < edges.length; i++) {
                const [ia, ib] = edges[i];
                const a = mesh.vertices[ia];
                const b = mesh.vertices[ib];
                const mid = [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2];
                const worldMid = objectToWorld(obj, mid);
                const s = projectToScreen(worldMid, vp);
                if (!s) continue;
                if (s[0] >= cx1 && s[0] <= cx2 && s[1] >= cy1 && s[1] <= cy2) {
                    candidates.push({ index: i, localPoint: mid });
                }
            }
        } else if (mode === "face") {
            for (let i = 0; i < mesh.faces.length; i++) {
                const center = MeshOps.faceCenter(mesh, i);
                const world = objectToWorld(obj, center);
                const s = projectToScreen(world, vp);
                if (!s) continue;
                if (s[0] >= cx1 && s[0] <= cx2 && s[1] >= cy1 && s[1] <= cy2) {
                    candidates.push({ index: i, localPoint: center });
                }
            }
        }
        let count = 0;
        for (const c of candidates) {
            let visible = true;
            if (toolOptions.edit.boxMode === "visible") visible = isPointVisible(obj, c.localPoint);
            if (visible) {
                if (subtractive) targetSet.delete(c.index);
                else targetSet.add(c.index);
                count++;
            }
        }
        if (mode === "vertex") {
            editSelection.edges.clear();
            editSelection.faces.clear();
        } else if (mode === "edge") {
            editSelection.vertices.clear();
            editSelection.faces.clear();
        } else {
            editSelection.vertices.clear();
            editSelection.edges.clear();
        }
        setStatus("Box select: " + count + " seleccionad@s");
        render();
        updateProperties();
    }

    function performObjectBoxSelect(startX, startY, endX, endY, additive, subtractive) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x1 = Math.min(startX, endX);
        const y1 = Math.min(startY, endY);
        const x2 = Math.max(startX, endX);
        const y2 = Math.max(startY, endY);
        const cx1 = (x1 - rect.left) * scaleX;
        const cy1 = (y1 - rect.top) * scaleY;
        const cx2 = (x2 - rect.left) * scaleX;
        const cy2 = (y2 - rect.top) * scaleY;
        const vp = computeViewProjection();

        const targetSet = additive && !subtractive ? new Set(selectedIds) : new Set();
        let count = 0;

        objects.forEach(o => {
            if (!isObjectVisible(o)) return;
            const worldCenter = objectWorldCenter(o);
            const s = projectToScreen(worldCenter, vp);
            if (!s) return;
            if (s[0] >= cx1 && s[0] <= cx2 && s[1] >= cy1 && s[1] <= cy2) {
                if (subtractive) targetSet.delete(o.id);
                else targetSet.add(o.id);
                count++;
            }
        });

        selectedGroupId = null;
        selectedIds = targetSet;
        if (selectedIds.size > 0) selectedId = Array.from(selectedIds)[selectedIds.size - 1];
        else selectedId = null;
        updateOutliner();
        updateProperties();
        refreshToolsGrid();
        render();
        setStatus("Box select: " + count + " objeto(s)");
    }


    function doEdgeLoop(edgeIndex, additive) {
        const obj = getEditObject();
        if (!obj || !editSelection) return;
        const loop = MeshOps.edgeLoop(obj.mesh, edgeIndex);
        if (!additive) editSelection.edges.clear();
        for (const ei of loop) editSelection.edges.add(ei);
        editSelection.vertices.clear();
        editSelection.faces.clear();
        setStatus("Edge loop: " + loop.size + " aristas");
        render();
        updateProperties();
    }

    function doFaceLoop(startFace, nextFace, additive) {
        const obj = getEditObject();
        if (!obj || !editSelection) return;
        const loop = MeshOps.faceLoop(obj.mesh, startFace, nextFace);
        if (!additive) editSelection.faces.clear();
        for (const fi of loop) editSelection.faces.add(fi);
        editSelection.vertices.clear();
        editSelection.edges.clear();
        setStatus("Face loop: " + loop.size + " caras");
        render();
        updateProperties();
    }

    function doConnectedComponentFace(faceIndex, additive) {
        const obj = getEditObject();
        if (!obj) return;
        const comp = MeshOps.connectedComponentFaces(obj.mesh, faceIndex);
        if (!additive) editSelection.faces.clear();
        for (const fi of comp) editSelection.faces.add(fi);
        editSelection.vertices.clear();
        editSelection.edges.clear();
        setStatus("Isla conectada: " + comp.size + " caras");
        render();
        updateProperties();
    }


    function getSelectionPivotLocal() {
        const obj = getEditObject();
        if (!obj || !editSelection) return null;
        if (editSelection.mode === "vertex" && editSelection.vertices.size > 0) {
            let x = 0, y = 0, z = 0;
            for (const vi of editSelection.vertices) {
                const v = obj.mesh.vertices[vi];
                x += v[0]; y += v[1]; z += v[2];
            }
            const n = editSelection.vertices.size;
            return [x / n, y / n, z / n];
        }
        if (editSelection.mode === "edge" && editSelection.edges.size > 0) {
            let x = 0, y = 0, z = 0, count = 0;
            for (const ei of editSelection.edges) {
                const edge = MeshOps.edgeFromIndex(obj.mesh, ei);
                if (!edge) continue;
                const a = obj.mesh.vertices[edge[0]];
                const b = obj.mesh.vertices[edge[1]];
                x += (a[0]+b[0])/2; y += (a[1]+b[1])/2; z += (a[2]+b[2])/2;
                count++;
            }
            if (count > 0) return [x / count, y / count, z / count];
        }
        if (editSelection.mode === "face" && editSelection.faces.size > 0) {
            let x = 0, y = 0, z = 0, count = 0;
            for (const fi of editSelection.faces) {
                const c = MeshOps.faceCenter(obj.mesh, fi);
                x += c[0]; y += c[1]; z += c[2];
                count++;
            }
            if (count > 0) return [x / count, y / count, z / count];
        }
        return null;
    }


    function doExtrude() {
        if (!editMode || !editSelection) return;
        const obj = getEditObject();
        if (!obj) return;
        if (editSelection.mode === "face" && editSelection.faces.size > 0) {
            pushHistory();
            const sorted = Array.from(editSelection.faces).sort((a, b) => b - a);
            editSelection.faces.clear();
            for (const fi of sorted) {
                MeshOps.extrudeFace(obj.mesh, fi, 0.3);
                editSelection.faces.add(fi);
            }
            setStatus(editSelection.faces.size + " cara(s) extruida(s)");
        } else if (editSelection.mode === "edge" && editSelection.edges.size > 0) {
            pushHistory();
            const sorted = Array.from(editSelection.edges).sort((a, b) => b - a);
            editSelection.edges.clear();
            for (const ei of sorted) {
                const result = MeshOps.extrudeEdge(obj.mesh, ei, 0.3, null);
                if (result) {
                    const edges = MeshOps.edges(obj.mesh);
                    for (let i = 0; i < edges.length; i++) {
                        const [a, b] = edges[i];
                        if ((a === result[0] && b === result[1]) || (a === result[1] && b === result[0])) {
                            editSelection.edges.add(i);
                            break;
                        }
                    }
                }
            }
            setStatus(editSelection.edges.size + " arista(s) extruida(s)");
        } else if (editSelection.mode === "vertex" && editSelection.vertices.size > 0) {
            pushHistory();
            const sorted = Array.from(editSelection.vertices).sort((a, b) => b - a);
            const newSet = new Set();
            for (const vi of sorted) {
                const newVi = MeshOps.extrudeVertex(obj.mesh, vi, [0.3, 0, 0]);
                if (newVi !== null) newSet.add(newVi);
            }
            editSelection.vertices = newSet;
            setStatus(newSet.size + " vértice(s) duplicado(s)");
        }
        render();
        updateProperties();
    }

    function doSubdivide() {
        if (!editMode || !editSelection) return;
        if (editSelection.mode !== "face" || editSelection.faces.size === 0) {
            setStatus("Selecciona al menos una cara (3) para subdividir");
            return;
        }
        const obj = getEditObject();
        pushHistory();
        const sorted = Array.from(editSelection.faces).sort((a, b) => b - a);
        for (const fi of sorted) MeshOps.subdivideFace(obj.mesh, fi);
        editSelection.faces.clear();
        setStatus("Caras subdivididas");
        render();
        updateProperties();
    }

    function doSubdivideAll() {
        const target = editMode ? getEditObject() : getSelected();
        if (!target) {
            setStatus("Selecciona un objeto para subdividir");
            return;
        }
        pushHistory();
        const lv = modelOptions.subdivLevels;
        MeshOps.applySubdivision(target.mesh, lv);
        if (editMode) {
            if (editSelection) {
                editSelection.vertices.clear();
                editSelection.edges.clear();
                editSelection.faces.clear();
            }
        }
        render();
        updateProperties();
        updateOutliner();
        setStatus("Subdividido " + lv + " nivel(es) · " +
            target.mesh.vertices.length + " verts · " +
            target.mesh.faces.length + " caras");
    }

    function doInset() {
        if (!editMode || !editSelection) {
            setStatus("Inset solo en modo edición (caras)");
            return;
        }
        if (editSelection.mode !== "face" || editSelection.faces.size === 0) {
            setStatus("Selecciona al menos una cara (3) para inset");
            return;
        }
        const obj = getEditObject();
        pushHistory();
        const sorted = Array.from(editSelection.faces).sort((a, b) => b - a);
        const amount = Math.max(0.01, Math.min(0.45, Number(modelOptions.bevelWidth) || 0.08));
        let count = 0;
        for (const fi of sorted) {
            if (MeshOps.bevelFace(obj.mesh, fi, amount, 1)) count++;
        }
        editSelection.faces.clear();
        setStatus("Inset: " + count + " cara(s)");
        render();
        updateProperties();
        updateOutliner();
    }

    function doFlipNormals() {
        if (!editMode || !editSelection) {
            if (selectedIds.size === 0) { setStatus("Selecciona un objeto"); return; }
            pushHistory();
            selectedIds.forEach(id => {
                const o = objects.find(ob => ob.id === id);
                if (!o) return;
                const all = o.mesh.faces.map((_, i) => i);
                MeshOps.flipFaces(o.mesh, all);
            });
            render();
            updateProperties();
            setStatus("Normales invertidas (objeto completo)");
            return;
        }
        const obj = getEditObject();
        if (!obj) return;
        pushHistory();
        let count = 0;
        if (editSelection.mode === "face" && editSelection.faces.size > 0) {
            count = MeshOps.flipFaces(obj.mesh, Array.from(editSelection.faces)) ? editSelection.faces.size : 0;
        } else if (editSelection.mode === "edge" && editSelection.edges.size > 0) {
            const faceSet = new Set();
            const edges = MeshOps.edges(obj.mesh);
            for (const ei of editSelection.edges) {
                const e = edges[ei];
                if (!e) continue;
                for (let fi = 0; fi < obj.mesh.faces.length; fi++) {
                    const f = obj.mesh.faces[fi];
                    const n = f.length;
                    for (let k = 0; k < n; k++) {
                        const a = f[k], b = f[(k + 1) % n];
                        if ((a === e[0] && b === e[1]) || (a === e[1] && b === e[0])) {
                            faceSet.add(fi);
                        }
                    }
                }
            }
            count = MeshOps.flipFaces(obj.mesh, Array.from(faceSet)) ? faceSet.size : 0;
        } else if (editSelection.mode === "vertex" && editSelection.vertices.size > 0) {
            const faceSet = new Set();
            for (const vi of editSelection.vertices) {
                for (let fi = 0; fi < obj.mesh.faces.length; fi++) {
                    if (obj.mesh.faces[fi].includes(vi)) faceSet.add(fi);
                }
            }
            count = MeshOps.flipFaces(obj.mesh, Array.from(faceSet)) ? faceSet.size : 0;
        }
        render();
        updateProperties();
        setStatus("Normales invertidas: " + count + " cara(s)");
    }

    function doDeleteSelected() {
        if (!editMode || !editSelection) return;
        const obj = getEditObject();
        if (!obj) return;
        if (editSelection.mode === "face" && editSelection.faces.size > 0) {
            pushHistory();
            const sorted = Array.from(editSelection.faces).sort((a, b) => b - a);
            for (const fi of sorted) MeshOps.deleteFace(obj.mesh, fi);
            MeshOps.compactMesh(obj.mesh);
            editSelection.faces.clear();
            setStatus("Caras borradas");
        } else if (editSelection.mode === "edge" && editSelection.edges.size > 0) {
            pushHistory();
            MeshOps.deleteEdges(obj.mesh, Array.from(editSelection.edges));
            editSelection.edges.clear();
            setStatus("Aristas borradas");
        } else if (editSelection.mode === "vertex" && editSelection.vertices.size > 0) {
            pushHistory();
            MeshOps.deleteVertices(obj.mesh, Array.from(editSelection.vertices));
            editSelection.vertices.clear();
            setStatus("Vértices borrados");
        } else {
            setStatus("Nada seleccionado");
            return;
        }
        render();
        updateProperties();
    }

    function doMergeContextual(mode) {
        if (!editMode || !editSelection) return;
        const obj = getEditObject();
        if (!obj) return;
        if (editSelection.mode === "vertex" && editSelection.vertices.size >= 2) {
            pushHistory();
            const sorted = Array.from(editSelection.vertices).sort((a, b) => a - b);
            MeshOps.mergeVertices(obj.mesh, sorted, mode);
            editSelection.vertices.clear();
            setStatus("Merge vértices " + (mode === "last" ? "to last" : "to center"));
            render();
            updateProperties();
        } else if (editSelection.mode === "edge" && editSelection.edges.size >= 1) {
            pushHistory();
            const sorted = Array.from(editSelection.edges);
            MeshOps.mergeEdgesToCenter(obj.mesh, sorted);
            editSelection.edges.clear();
            setStatus("Merge aristas to center");
            render();
            updateProperties();
        } else if (editSelection.mode === "face" && editSelection.faces.size >= 1) {
            const verts = new Set();
            for (const fi of editSelection.faces) {
                const face = obj.mesh.faces[fi];
                if (face) for (const vi of face) verts.add(vi);
            }
            if (verts.size >= 2) {
                pushHistory();
                MeshOps.mergeVertices(obj.mesh, Array.from(verts), mode);
                editSelection.faces.clear();
                setStatus("Merge caras al centro");
                render();
                updateProperties();
            }
        } else {
            setStatus("Selecciona vértices, aristas o caras");
        }
    }

    function doBridge() {
        if (!editMode || !editSelection) return;
        const obj = getEditObject();
        if (!obj) return;
        if (editSelection.mode === "face" && editSelection.faces.size === 2) {
            const fArr = Array.from(editSelection.faces);
            pushHistory();
            const ok = MeshOps.bridgeFaces(obj.mesh, fArr[0], fArr[1]);
            if (ok) { editSelection.faces.clear(); setStatus("Bridge entre 2 caras"); render(); updateProperties(); }
            return;
        }
        if (editSelection.mode === "edge" && editSelection.edges.size >= 2) {
            const eArr = Array.from(editSelection.edges);
            const check = MeshOps.bridgeEdgeSelection(obj.mesh, eArr, true);
            if (!check.ok) { setStatus("Bridge: " + check.reason); return; }
            pushHistory();
            const res = MeshOps.bridgeEdgeSelection(obj.mesh, eArr);
            if (res.ok) {
                editSelection.edges.clear();
                setStatus("Bridge entre 2 cadenas de aristas");
                render();
                updateProperties();
            }
            return;
        }
        setStatus("Selecciona 2 caras o 2 aristas/loops");
    }


    function beginEditTransform(tool, axis, shiftKey) {
        const obj = getEditObject();
        if (!obj || !editSelection) return false;
        pushHistory();
        let vertexIndices = [];
        let extruded = false;
        if (editSelection.mode === "vertex" && editSelection.vertices.size > 0) {
            if (shiftKey) {
                const sorted = Array.from(editSelection.vertices).sort((a, b) => b - a);
                const newSet = new Set();
                for (const vi of sorted) {
                    const newVi = MeshOps.extrudeVertex(obj.mesh, vi, [0, 0, 0]);
                    if (newVi !== null) newSet.add(newVi);
                }
                editSelection.vertices = newSet;
                vertexIndices = Array.from(newSet);
                extruded = true;
            } else vertexIndices = Array.from(editSelection.vertices);
        } else if (editSelection.mode === "edge" && editSelection.edges.size > 0) {
            if (shiftKey) {
                const sorted = Array.from(editSelection.edges).sort((a, b) => b - a);
                const newSet = new Set();
                for (const ei of sorted) {
                    const result = MeshOps.extrudeEdge(obj.mesh, ei, 0, null);
                    if (result) {
                        const edges = MeshOps.edges(obj.mesh);
                        for (let i = 0; i < edges.length; i++) {
                            const [a, b] = edges[i];
                            if ((a === result[0] && b === result[1]) || (a === result[1] && b === result[0])) {
                                newSet.add(i);
                                vertexIndices.push(result[0], result[1]);
                                break;
                            }
                        }
                    }
                }
                editSelection.edges = newSet;
                extruded = true;
            } else {
                for (const ei of editSelection.edges) {
                    const edge = MeshOps.edgeFromIndex(obj.mesh, ei);
                    if (edge) vertexIndices.push(edge[0], edge[1]);
                }
                vertexIndices = Array.from(new Set(vertexIndices));
            }
        } else if (editSelection.mode === "face" && editSelection.faces.size > 0) {
            if (shiftKey) {
                const sorted = Array.from(editSelection.faces).sort((a, b) => b - a);
                for (const fi of sorted) MeshOps.extrudeFace(obj.mesh, fi, 0);
                const newSet = new Set();
                for (const fi of editSelection.faces) {
                    const face = obj.mesh.faces[fi];
                    if (face) {
                        for (const vi of face) vertexIndices.push(vi);
                        newSet.add(fi);
                    }
                }
                vertexIndices = Array.from(new Set(vertexIndices));
                extruded = true;
            } else {
                for (const fi of editSelection.faces) {
                    const face = obj.mesh.faces[fi];
                    if (face) for (const vi of face) vertexIndices.push(vi);
                }
                vertexIndices = Array.from(new Set(vertexIndices));
            }
        }
        if (vertexIndices.length === 0) return false;
        const pivotLocal = getSelectionPivotLocal();
        editTransform = {
            tool, axis, vertexIndices,
            initialPositions: vertexIndices.map(i => [...obj.mesh.vertices[i]]),
            pivotLocal, extruded
        };
        const label = tool === "move" ? "MOVIENDO" : tool === "rotate" ? "ROTANDO" : "ESCALANDO";
        setStatus(label + " (" + vertexIndices.length + " verts)");
        render();
        return true;
    }


    function applyEditTransform(dx, dy) {
        if (!editTransform) return;
        const obj = getEditObject();
        if (!obj) return;
        const tool = editTransform.tool;
        const axis = editTransform.axis;
        const pivot = editTransform.pivotLocal;
        const pivotWorld = pivot ? objectToWorld(obj, pivot) : obj.position;
        const k = pixelsToWorldAtPoint(pivotWorld);
        const basis = cameraBasis();
        const worldDelta = Vector3.add(
            Vector3.multiply(basis.right, dx * k),
            Vector3.multiply(basis.up, -dy * k)
        );
        const [rx, ry, rz] = obj.rotation.map(v => v * Math.PI / 180);
        const cx = Math.cos(rx), sx = Math.sin(rx);
        const cy = Math.cos(ry), sy = Math.sin(ry);
        const cz = Math.cos(rz), sz = Math.sin(rz);
        const R = [
            [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
            [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
            [-sy,     cy * sx,                cy * cx]
        ];
        const localDelta = [
            R[0][0]*worldDelta[0] + R[1][0]*worldDelta[1] + R[2][0]*worldDelta[2],
            R[0][1]*worldDelta[0] + R[1][1]*worldDelta[1] + R[2][1]*worldDelta[2],
            R[0][2]*worldDelta[0] + R[1][2]*worldDelta[1] + R[2][2]*worldDelta[2]
        ];
        localDelta[0] /= obj.scale[0] || 1;
        localDelta[1] /= obj.scale[1] || 1;
        localDelta[2] /= obj.scale[2] || 1;
        editTransform.vertexIndices.forEach((vi, idx) => {
            const p0 = editTransform.initialPositions[idx];
            if (tool === "move") {
                let d = localDelta;
                if (axis !== null) {
                    const amount = localDelta[axis];
                    d = [0, 0, 0];
                    d[axis] = amount;
                }
                obj.mesh.vertices[vi][0] = p0[0] + d[0];
                obj.mesh.vertices[vi][1] = p0[1] + d[1];
                obj.mesh.vertices[vi][2] = p0[2] + d[2];
            }
            if (tool === "rotate" && pivot) {
                let axisLocal;
                if (axis !== null) axisLocal = axis === 0 ? [1,0,0] : axis === 1 ? [0,1,0] : [0,0,1];
                else {
                    const [fx, fy, fz] = basis.forward;
                    axisLocal = [
                        R[0][0]*fx + R[1][0]*fy + R[2][0]*fz,
                        R[0][1]*fx + R[1][1]*fy + R[2][1]*fz,
                        R[0][2]*fx + R[1][2]*fy + R[2][2]*fz
                    ];
                }
                const angle = -dx * 0.01;
                const rot = rotatePointAroundAxis(p0, pivot, axisLocal, angle);
                obj.mesh.vertices[vi][0] = rot[0];
                obj.mesh.vertices[vi][1] = rot[1];
                obj.mesh.vertices[vi][2] = rot[2];
            }
            if (tool === "scale" && pivot) {
                let factorX = 1, factorY = 1, factorZ = 1;
                const amount = (dx - dy) * 0.005;
                if (axis !== null) {
                    if (axis === 0) factorX = Math.max(0.01, 1 + amount);
                    if (axis === 1) factorY = Math.max(0.01, 1 + amount);
                    if (axis === 2) factorZ = Math.max(0.01, 1 + amount);
                } else {
                    const f = Math.max(0.01, 1 + amount);
                    factorX = factorY = factorZ = f;
                }
                obj.mesh.vertices[vi][0] = pivot[0] + (p0[0] - pivot[0]) * factorX;
                obj.mesh.vertices[vi][1] = pivot[1] + (p0[1] - pivot[1]) * factorY;
                obj.mesh.vertices[vi][2] = pivot[2] + (p0[2] - pivot[2]) * factorZ;
            }
        });
        obj.mesh.version++;
        render();
    }

    function finishEditTransform(cancel = false) {
        if (!editTransform) return;
        const obj = getEditObject();
        if (cancel && obj) {
            editTransform.vertexIndices.forEach((vi, idx) => {
                const p = editTransform.initialPositions[idx];
                obj.mesh.vertices[vi][0] = p[0];
                obj.mesh.vertices[vi][1] = p[1];
                obj.mesh.vertices[vi][2] = p[2];
            });
            obj.mesh.version++;
        }
        editTransform = null;
        render();
        setStatus(cancel ? "Cancelado" : "Confirmado");
    }


    // ======================================
    // ACCIONES DE OBJETO
    // ======================================

    function duplicateObject(obj) {
        return {
            id: nextId++,
            name: obj.name + "_copy",
            type: obj.type,
            mesh: cloneMesh(obj.mesh),
            position: [obj.position[0] + 0.5, obj.position[1], obj.position[2] + 0.5],
            rotation: [...obj.rotation],
            scale: [...obj.scale],
            pivot: [...obj.pivot],
            color: [...obj.color],
            visible: obj.visible !== false,
            groupId: null
        };
    }

    function doDuplicateObject() {
        if (selectedIds.size === 0) return;
        pushHistory();
        const newIds = [];
        const origs = objects.filter(o => selectedIds.has(o.id));
        for (const obj of origs) {
            const dup = duplicateObject(obj);
            objects.push(dup);
            newIds.push(dup.id);
        }
        selectedIds = new Set(newIds);
        selectedId = newIds[newIds.length - 1];
        updateOutliner();
        updateProperties();
        refreshToolsGrid();
        render();
    }

    function duplicateEditSubElements() {
        if (!editMode || !editSelection) return;
        if (editSelectionCount() === 0) return;
        if (beginEditTransform("move", null, true)) {
            setStatus("Duplicado");
        }
    }

    function doCombineObjects() {
        if (selectedIds.size < 2) { setStatus("Selecciona al menos 2 objetos"); return; }
        pushHistory();
        const selectedObjects = objects.filter(o => selectedIds.has(o.id));
        const combinedMesh = MeshOps.combineMeshes(selectedObjects, 0.01);
        const newObj = {
            id: nextId++,
            name: "Combined_" + nextId,
            type: "Cubo",
            mesh: combinedMesh,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            pivot: meshCenter(combinedMesh),
            color: [...combinedMesh.color],
            visible: true,
            groupId: null
        };
        objects = objects.filter(o => !selectedIds.has(o.id));
        groups.forEach(g => {
            g.objectIds = g.objectIds.filter(id => !selectedIds.has(id));
        });
        groups = groups.filter(g => g.objectIds.length > 0);
        objects.push(newObj);
        selectedIds = new Set([newObj.id]);
        selectedId = newObj.id;
        updateOutliner();
        updateProperties();
        refreshToolsGrid();
        render();
        setStatus("Combinados en " + newObj.name);
    }

    function doSeparateObject() {
        if (selectedIds.size !== 1) { setStatus("Selecciona 1 objeto"); return; }
        const obj = getSelected();
        if (!obj) return;
        const components = MeshOps.separateMeshByComponents(obj.mesh);
        if (components.length <= 1) { setStatus("No hay islas para separar"); return; }
        pushHistory();
        const baseName = obj.name.replace(/_part\d+$/, "");
        const newIds = [];
        components.forEach((mesh, i) => {
            const newObj = {
                id: nextId++,
                name: baseName + "_part" + (i + 1),
                type: obj.type,
                mesh,
                position: [...obj.position],
                rotation: [...obj.rotation],
                scale: [...obj.scale],
                pivot: [...obj.pivot],
                color: [...obj.color],
                visible: obj.visible !== false,
                groupId: null
            };
            objects.push(newObj);
            newIds.push(newObj.id);
        });
        objects = objects.filter(o => o.id !== obj.id);
        selectedIds = new Set(newIds);
        selectedId = newIds[newIds.length - 1];
        updateOutliner();
        updateProperties();
        refreshToolsGrid();
        render();
        setStatus("Separado en " + components.length + " objetos");
    }

    function doFreezeTransform() {
        if (selectedIds.size === 0) return;
        pushHistory();
        selectedIds.forEach(id => {
            const o = objects.find(ob => ob.id === id);
            if (!o) return;
            MeshOps.applyTransformToVertices(o.mesh, o.position, o.rotation, o.scale, o.pivot);
            o.position = [0, 0, 0];
            o.rotation = [0, 0, 0];
            o.scale = [1, 1, 1];
            o.pivot = [0, 0, 0];
            o.mesh.version++;
        });
        updateProperties();
        render();
        setStatus("Freeze aplicado");
    }

    function doHistoryClean() {
        if (selectedIds.size === 0) return;
        pushHistory();
        selectedIds.forEach(id => {
            const o = objects.find(ob => ob.id === id);
            if (!o) return;
            MeshOps.compactMesh(o.mesh);
            MeshOps.fixWindingByComponent(o.mesh);
        });
        updateProperties();
        render();
        setStatus("Historial limpiado");
    }

    function doCenterPivot() {
        if (selectedIds.size === 0) return;
        pushHistory();
        selectedIds.forEach(id => {
            const o = objects.find(ob => ob.id === id);
            if (!o) return;
            const newPivot = meshCenter(o.mesh);
            const oldModel = Matrix4.compose(o.position, o.rotation, o.scale, o.pivot);
            const centerWorld = [
                oldModel[0]*newPivot[0] + oldModel[4]*newPivot[1] + oldModel[8]*newPivot[2] + oldModel[12],
                oldModel[1]*newPivot[0] + oldModel[5]*newPivot[1] + oldModel[9]*newPivot[2] + oldModel[13],
                oldModel[2]*newPivot[0] + oldModel[6]*newPivot[1] + oldModel[10]*newPivot[2] + oldModel[14]
            ];
            const RS = Matrix4.rotationScale(o.rotation, o.scale);
            const px = newPivot[0], py = newPivot[1], pz = newPivot[2];
            const rsPivot = [
                RS[0]*px + RS[4]*py + RS[8]*pz,
                RS[1]*px + RS[5]*py + RS[9]*pz,
                RS[2]*px + RS[6]*py + RS[10]*pz
            ];
            o.pivot = newPivot;
            o.position = [
                centerWorld[0] - rsPivot[0],
                centerWorld[1] - rsPivot[1],
                centerWorld[2] - rsPivot[2]
            ];
        });
        updateProperties();
        render();
        setStatus("Pivot centrado");
    }


    // ======================================
    // PICKING
    // ======================================

    function pickObject(mouseX, mouseY) {
        const ray = Raycast.rayFromScreen(canvas, camera, mouseX, mouseY);
        const visibleObjects = objects.filter(o => isObjectVisible(o));
        const hit = Raycast.pickObjects(visibleObjects, ray);
        return hit ? hit.object : null;
    }


    function showBoxRect(x1, y1, x2, y2) {
        const viewportRect = viewport.getBoundingClientRect();
        const left = Math.min(x1, x2) - viewportRect.left;
        const top = Math.min(y1, y2) - viewportRect.top;
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        boxRect.style.display = "block";
        boxRect.style.left = left + "px";
        boxRect.style.top = top + "px";
        boxRect.style.width = width + "px";
        boxRect.style.height = height + "px";
    }
    function hideBoxRect() { boxRect.style.display = "none"; }


    // ======================================
    // EXPORTAR OBJ / MTL
    // ======================================

    function sanitizeFileName(name) {
        let n = (name || "").trim();
        if (!n) n = "model-lab-scene";
        n = n.replace(/[\\/:*?"<>|]+/g, "_");
        return n;
    }

    function sanitizeOBJName(name) {
        return (name || "Object")
            .trim()
            .replace(/\s+/g, "_")
            .replace(/[^\w\-.]/g, "_") || "Object";
    }

    function collectExportObjects(scope) {
        const visible = objects.filter(o => isObjectVisible(o));
        if (scope === "selection") {
            const selectedVisible = visible.filter(o => selectedIds.has(o.id));
            if (selectedVisible.length > 0) return { list: selectedVisible, effectiveScope: "selection" };
            return { list: visible, effectiveScope: "scene" };
        }
        return { list: visible, effectiveScope: "scene" };
    }

    function buildOBJAndMTL(objs, wantMTL, baseName) {
        const objLines = [];
        objLines.push("# MODEL LAB · export OBJ");
        objLines.push("# " + new Date().toISOString());
        if (wantMTL) objLines.push("mtllib " + baseName + ".mtl");
        objLines.push("");

        const mtlLines = [];
        if (wantMTL) {
            mtlLines.push("# MODEL LAB · MTL");
            mtlLines.push("# " + new Date().toISOString());
            mtlLines.push("");
        }

        let vOffset = 1;
        let vnOffset = 1;

        for (const obj of objs) {
            const mesh = obj.mesh;
            const m = Matrix4.compose(obj.position, obj.rotation, obj.scale, obj.pivot);

            const objName = sanitizeOBJName(obj.name || ("Object_" + obj.id));
            const matName = objName + "_mat";

            objLines.push("o " + objName);
            if (wantMTL) objLines.push("usemtl " + matName);

            // Vértices en world space
            for (const v of mesh.vertices) {
                const x = v[0], y = v[1], z = v[2];
                const wx = m[0]*x + m[4]*y + m[8] *z + m[12];
                const wy = m[1]*x + m[5]*y + m[9] *z + m[13];
                const wz = m[2]*x + m[6]*y + m[10]*z + m[14];
                objLines.push("v " + wx.toFixed(6) + " " + wy.toFixed(6) + " " + wz.toFixed(6));
            }

            // Normales por cara
            const faceNormals = [];
            for (let fi = 0; fi < mesh.faces.length; fi++) {
                const n = MeshOps.faceNormal(mesh, fi);
                const wnx = m[0]*n[0] + m[4]*n[1] + m[8] *n[2];
                const wny = m[1]*n[0] + m[5]*n[1] + m[9] *n[2];
                const wnz = m[2]*n[0] + m[6]*n[1] + m[10]*n[2];
                const len = Math.hypot(wnx, wny, wnz) || 1;
                faceNormals.push([wnx/len, wny/len, wnz/len]);
                objLines.push("vn " + (wnx/len).toFixed(6) + " " + (wny/len).toFixed(6) + " " + (wnz/len).toFixed(6));
            }

            // Caras
            for (let fi = 0; fi < mesh.faces.length; fi++) {
                const face = mesh.faces[fi];
                if (face.length < 3) continue;
                const parts = [];
                for (let i = 0; i < face.length; i++) {
                    const vi = face[fi === fi ? i : i];
                    parts.push((vOffset + vi) + "//" + (vnOffset + fi));
                }
                objLines.push("f " + parts.join(" "));
            }

            vOffset += mesh.vertices.length;
            vnOffset += mesh.faces.length;

            objLines.push("");

            if (wantMTL) {
                const c = obj.color || [0.62, 0.65, 0.75];
                mtlLines.push("newmtl " + matName);
                mtlLines.push("Ka 0.200000 0.200000 0.200000");
                mtlLines.push("Kd " + c[0].toFixed(6) + " " + c[1].toFixed(6) + " " + c[2].toFixed(6));
                mtlLines.push("Ks 0.500000 0.500000 0.500000");
                mtlLines.push("Ns 32.000000");
                mtlLines.push("d 1.000000");
                mtlLines.push("illum 2");
                mtlLines.push("");
            }
        }

        return {
            objText: objLines.join("\n"),
            mtlText: wantMTL ? mtlLines.join("\n") : null
        };
    }

    function downloadText(text, filename, mime) {
        const blob = new Blob([text], { type: mime || "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function openExportModal() {
        exportNameInput.value = "model-lab-scene";
        exportMtlCheck.checked = true;
        const scopeScene = document.querySelector('input[name="exportScope"][value="scene"]');
        if (scopeScene) scopeScene.checked = true;
        exportModal.hidden = false;
        setTimeout(() => exportNameInput.select(), 30);
    }

    function closeExportModal() {
        exportModal.hidden = true;
    }

    function confirmExport() {
        const name = sanitizeFileName(exportNameInput.value);
        const wantMTL = exportMtlCheck.checked;
        const scopeInput = document.querySelector('input[name="exportScope"]:checked');
        const scope = scopeInput ? scopeInput.value : "scene";

        const { list, effectiveScope } = collectExportObjects(scope);
        if (list.length === 0) {
            setStatus("No hay objetos visibles para exportar");
            return;
        }

        const { objText, mtlText } = buildOBJAndMTL(list, wantMTL, name);

        downloadText(objText, name + ".obj", "text/plain");
        if (wantMTL && mtlText !== null) {
            setTimeout(() => downloadText(mtlText, name + ".mtl", "text/plain"), 80);
        }

        closeExportModal();

        const scopeLabel = effectiveScope === "selection"
            ? "selección (" + list.length + " objetos)"
            : "escena (" + list.length + " objetos)";
        setStatus("Exportado " + name + (wantMTL ? " (.obj + .mtl)" : " (.obj)") + " · " + scopeLabel);
    }


    // ======================================
    // BOTONES TOPBAR
    // ======================================

    const createMenuBtn = $("createMenuBtn");
    const createMenu = $("createMenu");

    createMenuBtn.onclick = (e) => {
        e.stopPropagation();
        createMenu.hidden = !createMenu.hidden;
    };

    document.addEventListener("click", (e) => {
        if (!createMenu.hidden && !e.target.closest(".dropdown")) {
            createMenu.hidden = true;
        }
    });

    createMenu.querySelectorAll("button[data-create]").forEach(btn => {
        btn.addEventListener("click", () => {
            createMenu.hidden = true;
            openCreateDrawer(btn.dataset.create);
        });
    });

    $("undoBtn").onclick = () => undo();
    $("redoBtn").onclick = () => redo();

    $("saveScene").onclick = () => {
        const data = {
            format: "MODEL_LAB",
            version: 5,
            toolOptions: JSON.parse(JSON.stringify(toolOptions)),
            knifeOptions: JSON.parse(JSON.stringify(knifeOptions)),
            modelOptions: JSON.parse(JSON.stringify(modelOptions)),
            groups: groups.map(g => ({
                id: g.id, name: g.name,
                visible: g.visible !== false,
                collapsed: !!g.collapsed,
                objectIds: [...g.objectIds],
                pivot: [...(g.pivot || [0, 0, 0])]
            })),
            objects: objects.map(o => ({
                id: o.id, name: o.name, type: o.type,
                position: o.position, rotation: o.rotation, scale: o.scale,
                pivot: o.pivot, color: o.color,
                visible: o.visible !== false,
                groupId: o.groupId || null,
                mesh: {
                    vertices: o.mesh.vertices.map(v => [v[0], v[1], v[2]]),
                    faces: o.mesh.faces.map(f => f.slice())
                }
            }))
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "model-lab-scene.json";
        link.click();
        URL.revokeObjectURL(url);
        setStatus("Escena guardada");
    };

    $("loadScene").onclick = () => $("fileInput").click();

    $("exportOBJ").onclick = () => openExportModal();
    $("closeExportModal").onclick = () => closeExportModal();
    $("cancelExport").onclick = () => closeExportModal();
    $("confirmExport").onclick = () => confirmExport();

    exportModal.addEventListener("click", (e) => {
        if (e.target === exportModal) closeExportModal();
    });

    exportNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); confirmExport(); }
    });

    function parseOBJ(text) {
    const vertices = [];
    const faces = [];

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const parts = line.split(/\s+/);

        if (parts[0] === "v") {
            if (parts.length < 4) continue;

            const vertex = parts.slice(1, 4).map(Number);
            if (!vertex.every(Number.isFinite)) {
                throw new Error("El OBJ contiene un vértice inválido");
            }
            vertices.push(vertex);
            continue;
        }

        if (parts[0] === "f") {
            const face = parts.slice(1).map(token => {
                const rawIndex = Number.parseInt(token.split("/")[0], 10);
                if (!Number.isInteger(rawIndex) || rawIndex === 0) {
                    throw new Error("El OBJ contiene un índice de cara inválido");
                }

                // OBJ usa índices positivos desde 1 y negativos
                // relativos al último vértice declarado.
                const index = rawIndex > 0
                    ? rawIndex - 1
                    : vertices.length + rawIndex;

                if (index < 0 || index >= vertices.length) {
                    throw new Error("El OBJ referencia un vértice inexistente");
                }
                return index;
            });

            if (face.length >= 3) faces.push(face);
        }
    }

    if (vertices.length === 0 || faces.length === 0) {
        throw new Error("El OBJ no contiene vértices y caras válidos");
    }

    return {
        vertices,
        faces,
        color: [0.62, 0.65, 0.75],
        version: 0,
        edgeMidpoints: new Map()
    };
}

    $("fileInput").addEventListener("change", async event => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            if (/\.obj$/i.test(file.name)) {
            const mesh = parseOBJ(await file.text());
            pushHistory();

            const id = nextId++;
            const object = {
                id,
                name: file.name.replace(/\.obj$/i, "") || "Importado",
                type: "OBJ",
                mesh,
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1],
                pivot: meshCenter(mesh),
                color: [...mesh.color],
                visible: true,
                groupId: null
            };

            // Se añade a la escena; no reemplaza los objetos existentes.
            objects.push(object);
            selectedIds = new Set([id]);
            selectedId = id;
            selectedGroupId = null;

            updateOutliner();
            updateProperties();
            updateToolOptions();
            refreshToolsGrid();
            $("selectionInfo").textContent = object.name;
            render();
            setStatus("OBJ importado: " + object.name);
            event.target.value = "";
            return;
            }

            const data = JSON.parse(await file.text());
            if (data.format !== "MODEL_LAB" || !Array.isArray(data.objects)) {
                throw new Error("Archivo incompatible");
            }
            pushHistory();
            if (data.toolOptions) Object.assign(toolOptions, data.toolOptions);
            if (data.knifeOptions) Object.assign(knifeOptions, data.knifeOptions);
            if (data.modelOptions) Object.assign(modelOptions, data.modelOptions);

            const loadedObjects = data.objects.map(raw => {
                const hasSavedMesh =
                    raw.mesh &&
                    Array.isArray(raw.mesh.vertices) &&
                    Array.isArray(raw.mesh.faces);

                if (!hasSavedMesh && !Geometry[raw.type]) {
                    throw new Error("Geometría desconocida: " + String(raw.type));
                }

                let mesh;

                if (hasSavedMesh) {
                    mesh = {
                        vertices: raw.mesh.vertices.map(v => [v[0], v[1], v[2]]),
                        faces: raw.mesh.faces.map(f => f.slice()),
                        color: raw.color ? [...raw.color] : [0.62, 0.65, 0.75],
                        version: 0,
                        edgeMidpoints: new Map()
                    };
                } else {
                    mesh = Geometry[raw.type]();
                }

                return {
                    ...raw,
                    mesh,
                    position: raw.position || [0, 0, 0],
                    rotation: raw.rotation || [0, 0, 0],
                    scale: raw.scale || [1, 1, 1],
                    pivot: raw.pivot || meshCenter(mesh),
                    color: raw.color || [...mesh.color],
                    visible: raw.visible !== false,
                    groupId: raw.groupId || null
                };
            });
            const loadedGroups = (data.groups || []).map(g => ({
                id: g.id,
                name: g.name || "Grupo",
                visible: g.visible !== false,
                collapsed: !!g.collapsed,
                objectIds: Array.isArray(g.objectIds) ? [...g.objectIds] : [],
                pivot: g.pivot ? [...g.pivot] : [0, 0, 0]
            }));
            objects = loadedObjects;
            groups = loadedGroups;
            nextId = Math.max(0, ...objects.map(o => o.id)) + 1;
            nextGroupId = Math.max(0, ...groups.map(g => g.id)) + 1;
            selectedIds.clear();
            selectedId = null;
            selectedGroupId = null;
            if (objects.length > 0) {
                selectedIds.add(objects[0].id);
                selectedId = objects[0].id;
            }
            updateOutliner();
            updateProperties();
            updateToolOptions();
            refreshToolsGrid();
            render();
            setStatus("Escena cargada");
        } catch (error) {
            setStatus("Error: " + error.message);
            console.error(error);
        }
        event.target.value = "";
    });


    // ======================================
    // DRAWER BOTONES
    // ======================================

    togglePropsBtn.onclick = () => toggleDrawer();
    closeDrawerBtn.onclick = () => closeDrawer();

    $("freezeTransform").onclick = () => doFreezeTransform();
    $("historyClean").onclick = () => doHistoryClean();
    $("centerPivot").onclick = () => doCenterPivot();


    // ======================================
    // TABS RAIL DERECHO
    // ======================================

    document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === tab));
            document.querySelectorAll(".tab-panel").forEach(p => {
                p.hidden = p.dataset.panel !== tab.dataset.tab;
            });
        });
    });


    // ======================================
    // SHORTCUTS COLAPSABLE
    // ======================================

    const shortcutsBox = $("shortcutsBox");
    const shortcutsToggle = $("shortcutsToggle");
    if (window.innerWidth < 1400) shortcutsBox.classList.add("collapsed");
    shortcutsToggle.onclick = () => {
        shortcutsBox.classList.toggle("collapsed");
    };


    // ======================================
    // RATÓN
    // ======================================

    viewport.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("contextmenu", (e) => {
        if (e.target.closest("#viewport") || e.target.closest(".right-rail")) {
            e.preventDefault();
        }
    });

    viewport.addEventListener("pointerdown", event => {
        if (event.target.closest("button, input, select, textarea, a")) return;
        if (event.button !== 0 && event.button !== 1) return;
        viewport.setPointerCapture(event.pointerId);

        if (hoverGizmo) { hoverGizmo = null; }

        if (event.button === 1 || event.altKey) {
            if (knifeActive) { knifeHover = null; hoverLoopPreview = null; drawOverlay(); }
            const isPan = event.button === 1 || event.shiftKey;
            drag = { mode: isPan ? "pan" : "orbit", x: event.clientX, y: event.clientY };
            return;
        }

        const now = performance.now();
        const dt = now - lastClickTime;
        const ddist = Math.hypot(event.clientX - lastClickX, event.clientY - lastClickY);
        const isDouble = (dt < DOUBLE_CLICK_MS) && (ddist < DOUBLE_CLICK_DIST);
        lastClickTime = now;
        lastClickX = event.clientX;
        lastClickY = event.clientY;

        if (knifeActive) {
            const modifiers = {
                shift: event.shiftKey,
                ctrl: event.ctrlKey || event.metaKey
            };
            const pick = pickKnifePoint(event.clientX, event.clientY, modifiers);

            if (!pick) {
                setStatus("Knife: haz clic sobre el objeto o cerca");
                return;
            }

            if (modifiers.ctrl && pick.kind === "edge" && pick.edgeIndex !== undefined) {
                knifeLoopPreview = {
                    edgeIndex: pick.edgeIndex,
                    position: loopPositionFromMouse(pick.t, modifiers.shift),
                    count: knifeOptions.count,
                    spread: knifeOptions.spread
                };
                hoverLoopPreview = null;
                drag = { mode: "knife-loop-slide", edgeIndex: pick.edgeIndex };
                setStatus("Loop cut · arrastra para deslizar · suelta para aplicar");
                drawOverlay();
                render();
                return;
            }

            knifePoints.push(pick);
            setStatus("Knife: " + knifePoints.length + " punto(s) · Enter confirmar");
            drawOverlay();
            render();
            return;
        }

        if (editMode) {
            if (editTransform) {
                drag = { mode: "edit-transform", x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
                return;
            }

            if (
                editSelection &&
                editSelectionCount() > 0 &&
                (currentTool === "move" || currentTool === "rotate" || currentTool === "scale") &&
                !isDouble
            ) {
                const pivotLocal = getSelectionPivotLocal();
                if (pivotLocal) {
                    const obj = getEditObject();
                    const pivotWorld = objectToWorld(obj, pivotLocal);
                    const hit = renderer.pickGizmoAt(pivotWorld, camera, event.clientX, event.clientY, currentTool, 61);
                    if (hit) {
                        if (beginEditTransform(currentTool, hit.axis, event.shiftKey)) {
                            drag = { mode: "edit-transform", x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
                            return;
                        }
                    }
                }
            }

            const pick = pickEditElement(event.clientX, event.clientY);
            const additive = event.shiftKey;
            const subtractive = event.ctrlKey || event.metaKey;

            if (isDouble && pick) {
                if (pick.kind === "edge" && editSelection.mode === "edge") { doEdgeLoop(pick.index, additive || subtractive); return; }
                if (pick.kind === "face" && editSelection.mode === "face") {
                    if (additive && editSelection.faces.size > 0) {
                        const prevFace = Array.from(editSelection.faces).find(fi => fi !== pick.index);
                        if (prevFace !== undefined) { doFaceLoop(prevFace, pick.index, false); return; }
                    }
                    doConnectedComponentFace(pick.index, additive || subtractive);
                    return;
                }
                if (pick.kind === "vertex" && editSelection.mode === "vertex") {
                    if (!additive && !subtractive) editSelection.vertices.clear();
                    if (subtractive) editSelection.vertices.delete(pick.index);
                    else editSelection.vertices.add(pick.index);
                    editSelection.edges.clear();
                    editSelection.faces.clear();
                    render();
                    updateProperties();
                    return;
                }
            }

            if (pick) {
                const targetSet =
                    editSelection.mode === "vertex" ? editSelection.vertices :
                    editSelection.mode === "edge"   ? editSelection.edges :
                                                       editSelection.faces;
                if (subtractive) targetSet.delete(pick.index);
                else if (additive) {
                    if (targetSet.has(pick.index)) targetSet.delete(pick.index);
                    else targetSet.add(pick.index);
                } else { targetSet.clear(); targetSet.add(pick.index); }
                if (editSelection.mode === "vertex") { editSelection.edges.clear(); editSelection.faces.clear(); }
                else if (editSelection.mode === "edge") { editSelection.vertices.clear(); editSelection.faces.clear(); }
                else { editSelection.vertices.clear(); editSelection.edges.clear(); }
                render();
                updateProperties();
                if ((currentTool === "move" || currentTool === "rotate" || currentTool === "scale") && editSelectionCount() > 0 && !isDouble) {
                    if (beginEditTransform(currentTool, null, event.shiftKey && !additive && !subtractive)) {
                        drag = { mode: "edit-transform", x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
                        return;
                    }
                }
                return;
            }

            if (!toolOptions.edit.boxSelect) {
                drag = { mode: "orbit", x: event.clientX, y: event.clientY };
                return;
            }

            boxSelectDrag = {
                startX: event.clientX,
                startY: event.clientY,
                additive: event.shiftKey,
                subtractive: event.ctrlKey || event.metaKey
            };
            viewport.classList.add("box-selecting");
            showBoxRect(event.clientX, event.clientY, event.clientX, event.clientY);
            return;
        }

        if (multiTransform) { drag = { mode: "multi-transform", startX: event.clientX, startY: event.clientY }; return; }
        if (groupTransform) { drag = { mode: "group-transform", startX: event.clientX, startY: event.clientY }; return; }
        if (transform) { drag = { mode: "transform", startX: event.clientX, startY: event.clientY }; return; }

        if (selectedGroupId !== null) {
            const g = getGroup(selectedGroupId);
            if (g && (currentTool === "move" || currentTool === "rotate" || currentTool === "scale")) {
                const pivotWorld = g.pivot || [0, 0, 0];
                const hit = renderer.pickGizmoAt(pivotWorld, camera, event.clientX, event.clientY, currentTool, 99);
                if (hit) {
                    pushHistory();
                    beginGroupTransform(currentTool, hit.axis);
                    if (groupTransform) { drag = { mode: "group-transform", startX: event.clientX, startY: event.clientY }; return; }
                }
            }
        }

        if ((currentTool === "move" || currentTool === "rotate" || currentTool === "scale") && selectedId !== null) {
            const selected = getSelected();
            if (selected && isObjectVisible(selected)) {
                const hit = renderer.pickGizmo(selected, camera, event.clientX, event.clientY, currentTool);
                if (hit) {
                    pushHistory();
                    if (selectedIds.size > 1) {
                        beginMultiTransform(currentTool, hit.axis);
                        if (multiTransform) { drag = { mode: "multi-transform", startX: event.clientX, startY: event.clientY }; return; }
                    } else {
                        beginTransform(currentTool, hit.axis);
                        if (transform) { drag = { mode: "transform", startX: event.clientX, startY: event.clientY }; return; }
                    }
                }
            }
        }

        if (currentTool === "select" && toolOptions.select.boxSelect && !isDouble && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            const object = pickObject(event.clientX, event.clientY);
            if (!object) {
                boxSelectDrag = {
                    startX: event.clientX,
                    startY: event.clientY,
                    additive: false,
                    subtractive: false,
                    objectMode: true
                };
                viewport.classList.add("box-selecting");
                showBoxRect(event.clientX, event.clientY, event.clientX, event.clientY);
                return;
            }
        }

        const object = pickObject(event.clientX, event.clientY);
        if (object) {
            if (event.shiftKey || event.ctrlKey || event.metaKey) {
                toggleObjectSelection(object.id);
            } else if (selectedIds.has(object.id) && selectedIds.size > 1) {
                // Ya forma parte de una selección múltiple: no la colapsamos.
            } else {
                selectObject(object.id);
            }
        } else {
            if (!event.shiftKey && !event.ctrlKey && !event.metaKey) selectObject(null);
        }

        drag = { mode: "orbit", x: event.clientX, y: event.clientY };
        render();
    });


    viewport.addEventListener("pointermove", event => {
        const navigating = drag && (drag.mode === "orbit" || drag.mode === "pan");

        if (!drag && !boxSelectDrag) {
            let newHover = null;
            if (!editMode && selectedGroupId !== null) {
                const g = getGroup(selectedGroupId);
                if (g && (currentTool === "move" || currentTool === "rotate" || currentTool === "scale")) {
                    const hit = renderer.pickGizmoAt(g.pivot || [0,0,0], camera,
                        event.clientX, event.clientY, currentTool, 99);
                    if (hit) newHover = { kind: "group", axis: hit.axis };
                }
            } else if (!editMode && selectedId !== null) {
                const sel = getSelected();
                if (sel && (currentTool === "move" || currentTool === "rotate" || currentTool === "scale")) {
                    const hit = renderer.pickGizmo(sel, camera, event.clientX, event.clientY, currentTool);
                    if (hit) newHover = { kind: "object", axis: hit.axis };
                }
            } else if (editMode && editSelection && editSelectionCount() > 0 &&
                       (currentTool === "move" || currentTool === "rotate" || currentTool === "scale")) {
                const obj = getEditObject();
                const pivotLocal = getSelectionPivotLocal();
                if (obj && pivotLocal) {
                    const pivotWorld = objectToWorld(obj, pivotLocal);
                    const hit = renderer.pickGizmoAt(pivotWorld, camera,
                        event.clientX, event.clientY, currentTool, 61);
                    if (hit) newHover = { kind: "edit", axis: hit.axis };
                }
            }
            const prev = hoverGizmo ? hoverGizmo.axis : null;
            const next = newHover ? newHover.axis : null;
            if (prev !== next) {
                hoverGizmo = newHover;
                viewport.style.cursor = newHover ? "grab" : "";
                if (newHover) {
                    const axName = newHover.axis === 0 ? "X" : newHover.axis === 1 ? "Y" : newHover.axis === 2 ? "Z" : "libre";
                    setStatus("Gizmo: eje " + axName);
                }
                render();
            }
        }

        if (knifeActive && !navigating) {
            lastKnifeMouse.x = event.clientX;
            lastKnifeMouse.y = event.clientY;

            if (drag && drag.mode === "knife-loop-slide" && knifeLoopPreview) {
                const obj = getEditObject() || getSelected();
                const t = obj ? edgeMouseT(obj, drag.edgeIndex, event.clientX, event.clientY) : null;
                knifeLoopPreview.position = loopPositionFromMouse(t, event.shiftKey);
                drawOverlay();
                return;
            }

            if (knifeLoopPreview) return;

            updateKnifeHover(event.clientX, event.clientY, event.ctrlKey || event.metaKey, event.shiftKey);
            return;
        }

        if (boxSelectDrag) {
            showBoxRect(boxSelectDrag.startX, boxSelectDrag.startY, event.clientX, event.clientY);
            return;
        }
        if (!drag) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;

        if (drag.mode === "orbit") {
            camera.yaw -= dx * 0.008;
            camera.pitch = Math.max(-1.45, Math.min(1.45, camera.pitch + dy * 0.008));
            render();
        }
        if (drag.mode === "pan") {
            const basis = cameraBasis();
            const factor = camera.radius * 0.0018;
            camera.target = Vector3.add(
                camera.target,
                Vector3.add(
                    Vector3.multiply(basis.right, -dx * factor),
                    Vector3.multiply(basis.up, dy * factor)
                )
            );
            render();
        }
        if (drag.mode === "transform" && transform) applyTransform(event.clientX - drag.startX, event.clientY - drag.startY);
        if (drag.mode === "multi-transform" && multiTransform) applyTransform(event.clientX - drag.startX, event.clientY - drag.startY);
        if (drag.mode === "group-transform" && groupTransform) applyTransform(event.clientX - drag.startX, event.clientY - drag.startY);
        if (drag.mode === "edit-transform" && editTransform) applyEditTransform(event.clientX - drag.startX, event.clientY - drag.startY);
    });


    viewport.addEventListener("pointerup", event => {
        if (boxSelectDrag) {
            const b = boxSelectDrag;
            boxSelectDrag = null;
            viewport.classList.remove("box-selecting");
            hideBoxRect();
            const w = Math.abs(event.clientX - b.startX);
            const h = Math.abs(event.clientY - b.startY);
            if (w < 3 && h < 3) {
                if (b.objectMode) selectObject(null);
                else if (editSelection) {
                    editSelection.vertices.clear();
                    editSelection.edges.clear();
                    editSelection.faces.clear();
                    render();
                    updateProperties();
                }
            } else {
                if (b.objectMode) performObjectBoxSelect(b.startX, b.startY, event.clientX, event.clientY, b.additive, b.subtractive);
                else performBoxSelect(b.startX, b.startY, event.clientX, event.clientY, b.additive, b.subtractive);
            }
            return;
        }
        if (drag?.mode === "knife-loop-slide") {
            drag = null;
            confirmKnife();
            return;
        }
        if (drag?.mode === "transform") finishTransform();
        if (drag?.mode === "multi-transform") finishTransform();
        if (drag?.mode === "group-transform") finishTransform();
        if (drag?.mode === "edit-transform") finishEditTransform();
        drag = null;
        if (hoverGizmo) { hoverGizmo = null; viewport.style.cursor = ""; render(); }
    });

    viewport.addEventListener("pointercancel", () => {
        if (boxSelectDrag) {
            boxSelectDrag = null;
            viewport.classList.remove("box-selecting");
            hideBoxRect();
        }
        if (drag?.mode === "transform") finishTransform(true);
        if (drag?.mode === "multi-transform") finishTransform(true);
        if (drag?.mode === "group-transform") finishTransform(true);
        if (drag?.mode === "edit-transform") finishEditTransform(true);
        drag = null;
        if (hoverGizmo) { hoverGizmo = null; viewport.style.cursor = ""; render(); }
    });

    viewport.addEventListener("wheel", event => {
        event.preventDefault();

        const loopPrev = knifeLoopPreview || hoverLoopPreview;
        if (knifeActive && loopPrev) {
            const c = Math.max(1, Math.min(10, knifeOptions.count + (event.deltaY < 0 ? 1 : -1)));
            knifeOptions.count = c;
            loopPrev.count = c;
            drawOverlay();
            setStatus("Loop cut: " + c + " cortes");
            return;
        }

        camera.radius = Math.max(2, Math.min(60, camera.radius * Math.exp(event.deltaY * 0.001)));
        render();
    }, { passive: false });


    // ======================================
    // TECLADO
    // ======================================

    window.addEventListener("keyup", event => {
        if (knifeActive && (event.key === "Control" || event.key === "Meta") && hoverLoopPreview) {
            hoverLoopPreview = null;
            drawOverlay();
        }
    });

    window.addEventListener("keydown", event => {
        if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
        const key = event.key.toLowerCase();
        const ctrl = event.ctrlKey || event.metaKey;

        if (event.key === "Escape") {
            if (!exportModal.hidden) { closeExportModal(); return; }
            if (!propertiesDrawer.hidden) {
                closeDrawer();
                return;
            }
        }

        if (editMode && !ctrl && !event.altKey && !knifeActive) {
            if (key === "1") { event.preventDefault(); setEditSubMode("vertex"); return; }
            if (key === "2") { event.preventDefault(); setEditSubMode("edge");   return; }
            if (key === "3") { event.preventDefault(); setEditSubMode("face");   return; }
        }

        if (key === "k" && !ctrl && !event.altKey) {
            event.preventDefault();
            if (knifeActive) exitKnifeMode();
            else enterKnifeMode();
            return;
        }

        if (knifeActive) {
            if ((event.key === "Control" || event.key === "Meta") && !event.repeat) {
                updateKnifeHover(lastKnifeMouse.x, lastKnifeMouse.y, true, event.shiftKey);
                return;
            }
            if (event.key === "Enter") { event.preventDefault(); confirmKnife(); return; }
            if (event.key === "Escape") { event.preventDefault(); exitKnifeMode(); return; }
            if (event.key === "Backspace") {
                event.preventDefault();
                if (knifePoints.length > 0) {
                    knifePoints.pop();
                    drawOverlay();
                    setStatus("Knife: " + knifePoints.length + " punto(s)");
                }
                return;
            }
            return;
        }

        if (ctrl && key === "z") {
            event.preventDefault();
            if (event.shiftKey) redo(); else undo();
            return;
        }
        if (ctrl && key === "y") {
            event.preventDefault();
            redo();
            return;
        }
        if (event.key === "Tab") {
            event.preventDefault();
            toggleEditMode();
            return;
        }
        if (ctrl && key === "d") {
            event.preventDefault();
            if (editMode) duplicateEditSubElements();
            else doDuplicateObject();
            return;
        }
        if (ctrl && key === "j") {
            event.preventDefault();
            if (!editMode) {
                if (event.shiftKey) doSeparateObject();
                else doCombineObjects();
            }
            return;
        }
        if (ctrl && key === "g") {
            event.preventDefault();
            if (event.shiftKey) {
                if (selectedGroupId !== null) ungroup(selectedGroupId);
                else {
                    const o = getSelected();
                    if (o && o.groupId !== null) ungroup(o.groupId);
                }
            } else createGroupFromSelection();
            return;
        }
        if (ctrl && event.shiftKey && key === "n") {
            event.preventDefault();
            doFlipNormals();
            return;
        }
        if (ctrl && event.shiftKey && key === "s") {
            event.preventDefault();
            doSubdivideAll();
            return;
        }

        if (!editMode && key === "h") {
            if (event.altKey) hideAllExceptSelected();
            else if (event.shiftKey) showAll();
            else toggleSelectedVisibility();
            return;
        }

        if (editMode) {
            if (editTransform) {
                if (event.key === "Enter") { finishEditTransform(); return; }
                if (event.key === "Escape") { finishEditTransform(true); return; }
                if (["x", "y", "z"].includes(key)) {
                    editTransform.axis = "xyz".indexOf(key);
                    render();
                    return;
                }
                return;
            }
            if (key === "a" && !ctrl && !event.altKey) {
                const obj = getEditObject();
                if (!obj || !editSelection) return;
                if (editSelection.mode === "vertex") {
                    editSelection.vertices.clear();
                    for (let i = 0; i < obj.mesh.vertices.length; i++) editSelection.vertices.add(i);
                } else if (editSelection.mode === "edge") {
                    editSelection.edges.clear();
                    const edges = MeshOps.edges(obj.mesh);
                    for (let i = 0; i < edges.length; i++) editSelection.edges.add(i);
                } else {
                    editSelection.faces.clear();
                    for (let i = 0; i < obj.mesh.faces.length; i++) editSelection.faces.add(i);
                }
                render();
                updateProperties();
                return;
            }
            if (key === "a" && event.altKey) {
                if (editSelection) {
                    editSelection.vertices.clear();
                    editSelection.edges.clear();
                    editSelection.faces.clear();
                    render();
                    updateProperties();
                }
                return;
            }
            if (key === "b" && !ctrl) { doBridge(); return; }
            if (key === "m" && !ctrl) {
                if (event.shiftKey) doMergeContextual("last");
                else doMergeContextual("center");
                return;
            }
            if (key === "q") { setTool("select"); return; }
            if (key === "w") { setTool("move");   return; }
            if (key === "e" && !ctrl) { setTool("rotate"); return; }
            if (key === "r" && !ctrl) { setTool("scale");  return; }
            if (key === "f") { focusSelected(); return; }
            if (ctrl && key === "e") { event.preventDefault(); doExtrude(); return; }
            if (ctrl && key === "r") { event.preventDefault(); doSubdivide(); return; }
            if (event.key === "Delete" || event.key === "Backspace" || key === "x") { doDeleteSelected(); return; }
            if (event.key === "Escape") {
                if (editSelection) {
                    editSelection.vertices.clear();
                    editSelection.edges.clear();
                    editSelection.faces.clear();
                    render();
                    updateProperties();
                }
                return;
            }
            return;
        }

        if (transform || multiTransform || groupTransform) {
            const tf = transform || multiTransform || groupTransform;
            if (["x", "y", "z"].includes(key)) {
                tf.axis = "xyz".indexOf(key);
                render();
                return;
            }
            if (event.key === "Enter") { finishTransform(); return; }
            if (event.key === "Escape") { finishTransform(true); return; }
        }
        if (key === "1") { setViewMode("solid");      return; }
        if (key === "2") { setViewMode("solid-wire"); return; }
        if (key === "3") { setViewMode("smooth");     return; }
        if (event.key === "PageUp" || key === "+" || key === "=") {
            smoothLevel = Math.min(5, smoothLevel + 1);
            renderer.pruneMeshCache(objects);
            render();
            updateProperties();
            return;
        }
        if (event.key === "PageDown" || key === "-") {
            smoothLevel = Math.max(1, smoothLevel - 1);
            renderer.pruneMeshCache(objects);
            render();
            updateProperties();
            return;
        }
        if (key === "q") { setTool("select"); return; }
        if (key === "w") { pushHistory(); setTool("move");   if (selectedGroupId !== null) beginGroupTransform("move");   else if (selectedIds.size > 1) beginMultiTransform("move");   else beginTransform("move");   return; }
        if (key === "e") { pushHistory(); setTool("rotate"); if (selectedGroupId !== null) beginGroupTransform("rotate"); else if (selectedIds.size > 1) beginMultiTransform("rotate"); else beginTransform("rotate"); return; }
        if (key === "r") { pushHistory(); setTool("scale");  if (selectedGroupId !== null) beginGroupTransform("scale");  else if (selectedIds.size > 1) beginMultiTransform("scale");  else beginTransform("scale");  return; }
        if (key === "f") { focusSelected(); return; }
        if (event.key === "Delete" || event.key === "Backspace") {
            if (selectedGroupId !== null) {
                const g = getGroup(selectedGroupId);
                if (g && confirm("¿Eliminar el grupo '" + g.name + "' y todos sus objetos?")) {
                    pushHistory();
                    g.objectIds.forEach(oid => { objects = objects.filter(o => o.id !== oid); });
                    groups = groups.filter(gr => gr.id !== g.id);
                    selectedGroupId = null;
                    updateOutliner();
                    updateProperties();
                    render();
                }
                return;
            }
            if (selectedIds.size > 0) {
                pushHistory();
                groups.forEach(g => { g.objectIds = g.objectIds.filter(id => !selectedIds.has(id)); });
                groups = groups.filter(g => g.objectIds.length > 0);
                objects = objects.filter(o => !selectedIds.has(o.id));
                selectedIds.clear();
                selectedId = null;
                updateOutliner();
                updateProperties();
                refreshToolsGrid();
                render();
            }
        }
    });


    // ======================================
    // BOTONES VIEWPORT
    // ======================================

    $("resetCamera").onclick = () => {
        camera.target = [0, 0, 0];
        camera.radius = 9;
        camera.yaw = Math.PI / 4;
        camera.pitch = 0.35;
        render();
    };
    $("frameSelected").onclick = () => focusSelected();


    window.MODEL_LAB_DEBUG = {
        getSelectedObject() { return getSelected(); },
        getSelectedIds() { return Array.from(selectedIds); },
        getGroups() { return groups; },
        getEditObject() { return getEditObject(); }
    };


    function initialize() {
        resizeOverlay();
        buildToolsGrid();
        updateOutliner();
        updateProperties();
        updateToolOptions();
        refreshToolsGrid();
        pushHistory();
        render();

        window.addEventListener("resize", () => {
            resizeOverlay();
            render();
        });

        document.addEventListener("fullscreenchange", () => {
            setTimeout(() => { resizeOverlay(); render(); }, 100);
        });
        document.addEventListener("webkitfullscreenchange", () => {
            setTimeout(() => { resizeOverlay(); render(); }, 100);
        });
    }

    initialize();

})();