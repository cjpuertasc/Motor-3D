MODEL LAB — MOTOR 3D LOCAL
==========================

REQUISITOS
- Un navegador moderno con WebGL 2 (Chrome, Edge o Firefox actualizado).
- No requiere instalar paquetes, frameworks ni librerías.
- No necesita conexión a Internet una vez que tengas la carpeta.

INICIO
1. Descomprime motor3d_local.zip.
2. Abre la carpeta motor3d_local.
3. Haz doble clic en index.html.
4. Si el navegador bloquea alguna función local, ejecuta un servidor estático:
   - Abre una terminal dentro de la carpeta.
   - Si tienes Python instalado, ejecuta: python -m http.server 8000
   - Abre http://localhost:8000 en el navegador.

CONTROLES
- Arrastrar con botón izquierdo: orbitar cámara.
- Rueda del ratón: acercar/alejar.
- Shift + arrastrar o botón central: desplazar cámara.
- Clic: seleccionar objeto (detección inicial aproximada por centro).
- G: iniciar mover; R: rotar; S: escalar; Q: selección.
- Durante transformación, X/Y/Z restringen el eje.
- Arrastrar para modificar; Enter confirma; Esc cancela.
- Delete/Backspace: eliminar objeto.
- Panel derecho: editar posición, rotación, escala y color.

FUNCIONES ACTUALES
- Renderizado 3D con WebGL 2 y shaders propios.
- Primitivas: cubo, esfera y cilindro.
- Cámara orbital con zoom y desplazamiento.
- Selección básica de objetos.
- Transformaciones básicas.
- Outliner y panel de propiedades.
- Guardar/cargar escena en JSON.

LIMITACIONES DE ESTA PRIMERA VERSIÓN
- La selección es aproximada y se basa en la cercanía al centro del objeto; aún no es picking preciso por triángulo.
- Las transformaciones con ratón son una interacción inicial, no tienen todavía los manipuladores visuales XYZ de Blender.
- No existe todavía edición de vértices, aristas o caras.
- No hay exportación OBJ/GLTF, materiales PBR, texturas ni historial deshacer/rehacer.

ESTRUCTURA
index.html
css/styles.css
js/math.js
js/geometry.js
js/renderer.js
js/editor.js

PRÓXIMA ETAPA RECOMENDADA
1. Selección precisa mediante raycasting.
2. Gizmos visibles de mover/rotar/escalar.
3. Modo objeto y modo edición.
4. Selección y edición de vértices, aristas y caras.
