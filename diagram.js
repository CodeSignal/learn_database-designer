// diagram.js
const DIAGRAM = { NODE_WIDTH: 240, ROW_H: 22, PADDING_X: 10, HEADER_H: 28, GAP: 8, ADD_ROW_H: 24, TOOLBAR_H: 28 };

/* --- on-canvas actions (set by app.js): onAddField, onEditField, onDeleteField, onForeignKey, onEditTable, onDeleteTable, onColorTable --- */
let ACTIONS = {};
function setActions(actions) { ACTIONS = actions || {}; }

/* 12x12 stroke icons */
const ICON_PATHS = {
  trash: 'M1.5,3 H10.5 M4.5,3 V1.5 H7.5 V3 M2.5,3 L3.2,10.5 H8.8 L9.5,3 M5,5 V8.5 M7,5 V8.5',
  edit: 'M2,10 L2.5,7.5 L8.5,1.5 L10.5,3.5 L4.5,9.5 Z M7.5,2.5 L9.5,4.5',
  link: 'M5,7 L7,5 M5.5,3.5 L6.8,2.2 A2.1,2.1 0 0 1 9.8,5.2 L8.5,6.5 M6.5,8.5 L5.2,9.8 A2.1,2.1 0 0 1 2.2,6.8 L3.5,5.5'
};

/* --- header colors (theme-aware via CSS variables) --- */
const TABLE_COLOR_VARS = {
    white: '--tbl-white',
    blue:  '--tbl-blue',
    green: '--tbl-green',
    red:   '--tbl-red',
  };

  function getHeaderFill(table) {
    const key = (table && table.color) || 'white';
    const varName = TABLE_COLOR_VARS[key] || '--tbl-white';
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return val || '#ffffff';
  }


/* Build a path for a rectangle that has ONLY the top corners rounded */
function roundedTopRectPath(x, y, w, h, rx, ry) {
  // Clamp radii so they make geometric sense
  rx = Math.max(0, Math.min(rx || 0, w / 2));
  ry = Math.max(0, Math.min(ry || 0, h));
  // Start at top-left inner corner (after radius)
  // Go to top-right inner corner, arc to the right wall, then down, across bottom, up left wall,
  // and arc back to the start to round the top-left corner.
  return [
    `M ${x + rx},${y}`,
    `H ${x + w - rx}`,
    `A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry}`,
    `V ${y + h}`,
    `H ${x}`,
    `V ${y + ry}`,
    `A ${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
    'Z'
  ].join(' ');
}

/* --- viewport (pan/zoom) state --- */
const VIEW = { k: 1, tx: 0, ty: 0 }; // scale, translate
function ensureViewport(svg) {
  let vp = svg.querySelector('#vp');
  if (!vp) {
    vp = createSvg('g', { id: 'vp' });
    // keep <defs> first (for markers)
    const defs = svg.querySelector('defs');
    if (defs?.nextSibling) svg.insertBefore(vp, defs.nextSibling);
    else svg.appendChild(vp);
  }
  return vp;
}
function applyView(svg) {
  const vp = ensureViewport(svg);
  vp.setAttribute('transform', `translate(${VIEW.tx},${VIEW.ty}) scale(${VIEW.k})`);
}

function clearDiagram(svg) {
  const vp = ensureViewport(svg);
  while (vp.firstChild) vp.removeChild(vp.firstChild);
}
function createSvg(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
function tableGeometry(table) {
  const rows = table.columns.length;
  const height = DIAGRAM.HEADER_H + DIAGRAM.GAP + rows * DIAGRAM.ROW_H + DIAGRAM.ADD_ROW_H + DIAGRAM.GAP;
  const width = DIAGRAM.NODE_WIDTH;
  const { x, y } = table.position || { x: 50, y: 50 };
  return { x, y, width, height, rows };
}
function columnCenterY(table, colId) {
  const { y } = tableGeometry(table);
  const idx = table.columns.findIndex(c => c.id === colId);
  const base = y + DIAGRAM.HEADER_H + DIAGRAM.GAP + DIAGRAM.ROW_H / 2;
  return base + idx * DIAGRAM.ROW_H;
}

/* Turn an SVG element into a keyboard-operable button. `focusKey` must be stable across
   re-renders: renderSchema uses it to put focus back on the redrawn element. */
function makeButton(el, { label, focusKey, onActivate, pressed }) {
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', label);
  el.setAttribute('data-focus', focusKey);
  if (pressed !== undefined) el.setAttribute('aria-pressed', String(!!pressed));
  el.addEventListener('click', (e) => { e.stopPropagation(); onActivate && onActivate(); });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat && onActivate) onActivate();
  });
  return el;
}

function iconButton({ x, y, size = 18, icon, title, focusKey, className = '', onClick }) {
  const btn = createSvg('g', { class: `icon-btn ${className}`.trim(), transform: `translate(${x},${y})` });
  const tip = createSvg('title'); tip.textContent = title; btn.appendChild(tip);
  btn.appendChild(createSvg('rect', { width: size, height: size, rx: 4, ry: 4, class: 'icon-btn-bg' }));
  const off = (size - 12) / 2;
  btn.appendChild(createSvg('path', { d: ICON_PATHS[icon], transform: `translate(${off},${off})`, class: 'icon-glyph' }));
  return makeButton(btn, { label: title, focusKey, onActivate: onClick });
}

/* Floating toolbar above the selected table: color swatches + edit + delete */
function renderTableToolbar(svg, table) {
  const { x, y } = tableGeometry(table);
  const h = DIAGRAM.TOOLBAR_H, r = 7, step = 22, pad = 8, btnSize = 20;
  const ty = y - h - 6;
  const keys = Object.keys(TABLE_COLOR_VARS);
  const swatchesEnd = x + pad + (keys.length - 1) * step + 2 * r;
  const editX = swatchesEnd + 14;
  const delX = editX + btnSize + 4;

  const bar = createSvg('g', { class: 'table-toolbar' });
  bar.addEventListener('click', (e) => e.stopPropagation());
  bar.appendChild(createSvg('rect', { x, y: ty, width: delX + btnSize + pad - x, height: h, rx: 6, ry: 6, class: 'table-toolbar-bg' }));

  const current = table.color || 'white';
  keys.forEach((key, i) => {
    const sw = createSvg('circle', {
      cx: x + pad + r + i * step, cy: ty + h / 2, r,
      fill: getHeaderFill({ color: key }),
      class: `color-swatch${key === current ? ' active' : ''}`
    });
    const tip = createSvg('title'); tip.textContent = `Color: ${key}`; sw.appendChild(tip);
    makeButton(sw, {
      label: `Color: ${key}`, focusKey: `swatch:${table.id}:${key}`, pressed: key === current,
      onActivate: () => ACTIONS.onColorTable && ACTIONS.onColorTable(table.id, key)
    });
    bar.appendChild(sw);
  });

  bar.appendChild(createSvg('line', { x1: swatchesEnd + 7, y1: ty + 6, x2: swatchesEnd + 7, y2: ty + h - 6, class: 'toolbar-sep' }));
  bar.appendChild(iconButton({
    x: editX, y: ty + (h - btnSize) / 2, size: btnSize, icon: 'edit', title: 'Edit table',
    focusKey: `edit-table:${table.id}`,
    onClick: () => ACTIONS.onEditTable && ACTIONS.onEditTable(table.id)
  }));
  bar.appendChild(iconButton({
    x: delX, y: ty + (h - btnSize) / 2, size: btnSize, icon: 'trash', className: 'danger', title: 'Delete table',
    focusKey: `delete-table:${table.id}`,
    onClick: () => ACTIONS.onDeleteTable && ACTIONS.onDeleteTable(table.id)
  }));

  ensureViewport(svg).appendChild(bar);
}

function renderTable(svg, table, schema, selectedTableId, selectedColId, onSelectTable, onSelectColumn) {
  const vp = ensureViewport(svg);
  const isTableSelected = table.id === selectedTableId;
  const g = createSvg('g', { class: `table${isTableSelected ? ' selected' : ''}`, 'data-id': table.id, role: 'group', 'aria-label': `Table ${table.name}` });
  const { x, y, width, height } = tableGeometry(table);

  // MAIN BOX (selection only)
  const cornerR = 8;
  const rect = createSvg('rect', { x, y, rx: cornerR, ry: cornerR, width, height, fill: '#fff', stroke: '#ccc', class: 'table-box' });
  g.appendChild(rect);

  // HEADER (only header changes color, with rounded top corners) — the keyboard target for selecting the table
  const headerBtn = createSvg('g', { class: 'table-select' });
  const headerFill = getHeaderFill(table);
  const headerPath = roundedTopRectPath(x, y, width, DIAGRAM.HEADER_H, cornerR, cornerR);
  headerBtn.appendChild(createSvg('path', { d: headerPath, fill: headerFill, class: 'table-header-bg' }));
  const title = createSvg('text', { x: x + DIAGRAM.PADDING_X, y: y + DIAGRAM.HEADER_H / 2, class: 'table-title', 'dominant-baseline': 'middle' });
  title.textContent = table.name; headerBtn.appendChild(title);
  makeButton(headerBtn, {
    label: `Select table ${table.name}`, focusKey: `table:${table.id}`, pressed: isTableSelected,
    onActivate: () => onSelectTable && onSelectTable(table.id)
  });
  g.appendChild(headerBtn);

  // HEADER SEPARATOR
  g.appendChild(createSvg('line', { x1: x, y1: y + DIAGRAM.HEADER_H, x2: x + width, y2: y + DIAGRAM.HEADER_H, stroke: '#d1d5db', 'stroke-width': '0.5' }));

  // DRAG BUTTON (the ONLY drag handle)
  const btnSize = 16;
  const hx = x + width - DIAGRAM.PADDING_X - btnSize;
  const hy = y + (DIAGRAM.HEADER_H - btnSize) / 2;

  const dragBtn = createSvg('g', { class: 'drag-button drag-handle', transform: `translate(${hx},${hy})`, 'aria-hidden': 'true' });
  dragBtn.appendChild(createSvg('rect', { width: btnSize, height: btnSize, rx: 4, ry: 4, class: 'drag-btn-bg' }));
  [[4, 5], [8, 5], [12, 5], [4, 10], [8, 10], [12, 10]].forEach(([cx, cy]) => {
    dragBtn.appendChild(createSvg('circle', { cx, cy, r: 1.3, class: 'drag-btn-dot' }));
  });
  dragBtn.addEventListener('click', (e) => { e.stopPropagation(); });
  g.appendChild(dragBtn);

  // COLUMNS (click a column to edit)
  table.columns.forEach((col, i) => {
    const cy = y + DIAGRAM.HEADER_H + DIAGRAM.GAP + i * DIAGRAM.ROW_H + DIAGRAM.ROW_H / 2;
    const isPK = (table.primaryKey || []).includes(col.id);
    const isFK = (schema.foreignKeys || []).some(fk =>
      (fk.from.table === table.id && fk.from.columns.includes(col.id)) ||
      (fk.to.table === table.id && fk.to.columns.includes(col.id))
    );
    const prefix = `${isPK ? '🔑 ' : ''}${isFK ? '🔗 ' : ''}`;
    const isSelected = col.id === selectedColId;
    const desc = `${col.name}: ${col.type}${col.nullable ? '' : ' NOT NULL'}`;
    const row = createSvg('g', { class: 'col-row' });
    row.appendChild(createSvg('rect', {
      x: x + 1, y: cy - DIAGRAM.ROW_H / 2, width: width - 2, height: DIAGRAM.ROW_H,
      class: `col-row-hit${isSelected ? ' col-row-selected' : ''}`
    }));
    const classes = ['col-text'];
    if (isSelected) classes.push('col-editing');
    const t = createSvg('text', { x: x + DIAGRAM.PADDING_X, y: cy, class: classes.join(' '), 'data-col-id': col.id, 'dominant-baseline': 'middle' });
    t.textContent = `${prefix}${desc}`;
    row.appendChild(t);
    makeButton(row, {
      label: `Select field ${desc}${isPK ? ', primary key' : ''}${isFK ? ', foreign key' : ''}`,
      focusKey: `col:${table.id}:${col.id}`, pressed: isSelected,
      onActivate: () => onSelectColumn && onSelectColumn(table.id, col.id)
    });
    g.appendChild(row);

    if (isSelected) {
      const size = 18, iy = cy - size / 2;
      const delX = x + width - DIAGRAM.PADDING_X - size;
      g.appendChild(iconButton({
        x: delX - 2 * (size + 4), y: iy, size, icon: 'link', title: 'Foreign key',
        focusKey: `fk:${table.id}:${col.id}`,
        onClick: () => ACTIONS.onForeignKey && ACTIONS.onForeignKey(table.id, col.id)
      }));
      g.appendChild(iconButton({
        x: delX - size - 4, y: iy, size, icon: 'edit', title: 'Edit field',
        focusKey: `edit-field:${table.id}:${col.id}`,
        onClick: () => ACTIONS.onEditField && ACTIONS.onEditField(table.id, col.id)
      }));
      g.appendChild(iconButton({
        x: delX, y: iy, size, icon: 'trash', className: 'danger', title: 'Delete field',
        focusKey: `delete-field:${table.id}:${col.id}`,
        onClick: () => ACTIONS.onDeleteField && ACTIONS.onDeleteField(table.id, col.id)
      }));
    }
  });

  // ADD FIELD ROW (opens the field pop-up)
  const addY = y + DIAGRAM.HEADER_H + DIAGRAM.GAP + table.columns.length * DIAGRAM.ROW_H;
  const addBtn = createSvg('g', { class: 'add-field-btn' });
  addBtn.appendChild(createSvg('rect', { x: x + DIAGRAM.PADDING_X / 2, y: addY + 2, width: width - DIAGRAM.PADDING_X, height: DIAGRAM.ADD_ROW_H - 4, rx: 4, ry: 4, class: 'add-field-bg' }));
  const addText = createSvg('text', { x: x + DIAGRAM.PADDING_X, y: addY + DIAGRAM.ADD_ROW_H / 2, class: 'add-field-text', 'dominant-baseline': 'middle' });
  addText.textContent = '+ Add field';
  addBtn.appendChild(addText);
  makeButton(addBtn, {
    label: `Add field to ${table.name}`, focusKey: `add-field:${table.id}`,
    onActivate: () => ACTIONS.onAddField && ACTIONS.onAddField(table.id)
  });
  g.appendChild(addBtn);

  // selection (click anywhere on the group EXCEPT the drag button / text handlers)
  g.addEventListener('click', (e) => { onSelectTable && onSelectTable(table.id); e.stopPropagation(); });

  const vpNode = ensureViewport(svg);
  vpNode.appendChild(g);
}

function ensureArrowMarker(svg) {
  let defs = svg.querySelector('defs'); if (!defs) { defs = createSvg('defs'); svg.appendChild(defs); }
  if (svg.querySelector('#arrow')) return;
  const marker = createSvg('marker', { id: 'arrow', markerWidth: 10, markerHeight: 7, refX: 10, refY: 3.5, orient: 'auto', markerUnits: 'strokeWidth' });
  marker.appendChild(createSvg('path', { d: 'M0,0 L10,3.5 L0,7 z', class: 'edge-marker' }));
  defs.appendChild(marker);
}

/* Which side ('left' | 'right') an FK arrow leaves the source table and enters the target table.
   Tables side by side: the facing sides. Stacked (horizontally overlapping) or self-reference:
   the same side on both, so the curve loops around the tables instead of cutting through them. */
function edgeSides(fromTable, toTable) {
  const W = DIAGRAM.NODE_WIDTH, minGap = 30;
  const fx = tableGeometry(fromTable).x, tx = tableGeometry(toTable).x;
  if (fromTable !== toTable) {
    if (tx >= fx + W + minGap) return { from: 'right', to: 'left' };
    if (tx + W + minGap <= fx) return { from: 'left', to: 'right' };
  }
  const side = tx < fx ? 'left' : 'right';
  return { from: side, to: side };
}

function edgePath(fromTable, fromColId, toTable, toColId) {
  const W = DIAGRAM.NODE_WIDTH;
  const sides = edgeSides(fromTable, toTable);
  const sideX = (table, side) => tableGeometry(table).x + (side === 'right' ? W : 0);
  const sx = sideX(fromTable, sides.from), sy = columnCenterY(fromTable, fromColId);
  const ex = sideX(toTable, sides.to), ey = columnCenterY(toTable, toColId);

  let c1x, c2x;
  if (sides.from !== sides.to) {
    const dx = Math.max(40, Math.abs(ex - sx) / 3);
    const out = sides.from === 'right' ? 1 : -1;
    c1x = sx + out * dx;
    c2x = ex - out * dx;
  } else {
    // both control points sit past the outermost of the two edges
    const loop = 50;
    c1x = c2x = sides.from === 'right' ? Math.max(sx, ex) + loop : Math.min(sx, ex) - loop;
  }
  return `M ${sx},${sy} C ${c1x},${sy} ${c2x},${ey} ${ex},${ey}`;
}

function renderEdge(svg, fk, schema) {
  const vp = ensureViewport(svg);
  const fromTable = schema.tables.find(t => t.id === fk.from.table);
  const toTable = schema.tables.find(t => t.id === fk.to.table);
  if (!fromTable || !toTable) return;
  const d = edgePath(fromTable, fk.from.columns[0], toTable, fk.to.columns[0]);
  vp.appendChild(createSvg('path', { d, class: 'edge', 'marker-end': 'url(#arrow)' }));
}

function renderSchema(svg, schema, selectedTableId, onSelectTable, onSelectColumn, selectedColId) {
  const active = document.activeElement;
  const focusKey = active && svg.contains(active) ? active.getAttribute('data-focus') : null;

  clearDiagram(svg); ensureArrowMarker(svg); applyView(svg);
  const selected = schema.tables.find(t => t.id === selectedTableId);
  schema.tables.forEach(t => { if (t !== selected) renderTable(svg, t, schema, selectedTableId, selectedColId, onSelectTable, onSelectColumn); });
  (schema.foreignKeys || []).forEach(fk => renderEdge(svg, fk, schema));
  // selected table and its toolbar go last: drawn on top, and next in Tab order after the table's own controls
  if (selected) {
    renderTable(svg, selected, schema, selectedTableId, selectedColId, onSelectTable, onSelectColumn);
    renderTableToolbar(svg, selected);
  }

  if (focusKey) {
    const target = [...svg.querySelectorAll('[data-focus]')].find(el => el.getAttribute('data-focus') === focusKey);
    if (target) target.focus({ preventScroll: true });
  }
}

/* --- pan/zoom on the background --- */
function clientToSvgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
  const ctm = svg.getScreenCTM(); return ctm ? pt.matrixTransform(ctm.inverse()) : { x: clientX, y: clientY };
}
function enablePanZoom(svg, onViewChanged) {
  // wheel to zoom at pointer
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const scaleFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newK = Math.max(0.2, Math.min(3, VIEW.k * scaleFactor));
    const pt = clientToSvgPoint(svg, e.clientX, e.clientY);
    // keep the point under cursor stable
    const vpX = (pt.x - VIEW.tx) / VIEW.k;
    const vpY = (pt.y - VIEW.ty) / VIEW.k;
    VIEW.k = newK;
    VIEW.tx = pt.x - vpX * VIEW.k;
    VIEW.ty = pt.y - vpY * VIEW.k;
    applyView(svg);
    onViewChanged && onViewChanged();
  }, { passive: false });

  // drag to pan (when not on a table)
  const pan = { active: false, pointerId: null, startX: 0, startY: 0, baseTx: 0, baseTy: 0 };
  svg.addEventListener('pointerdown', (e) => {
    const el = (e.target instanceof Element) ? e.target : null;
    const onTable = el?.closest('g.table, .table-toolbar');
    const onHandle = el?.closest('.drag-handle');
    if (onHandle || onTable) return; // tables handled by dragging code
    pan.active = true; pan.pointerId = e.pointerId; pan.startX = e.clientX; pan.startY = e.clientY;
    pan.baseTx = VIEW.tx; pan.baseTy = VIEW.ty;
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('panning');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pan.active || pan.pointerId !== e.pointerId) return;
    const dx = e.clientX - pan.startX, dy = e.clientY - pan.startY;
    VIEW.tx = pan.baseTx + dx; VIEW.ty = pan.baseTy + dy;
    applyView(svg);
  });
  function endPan(e) {
    if (!pan.active) return;
    pan.active = false;
    try { svg.releasePointerCapture(pan.pointerId); } catch (_) { }
    pan.pointerId = null;
    svg.classList.remove('panning');
    onViewChanged && onViewChanged();
  }
  svg.addEventListener('pointerup', endPan);
  svg.addEventListener('pointercancel', endPan);
}

/* --- dragging: ONLY starts from the drag button (.drag-handle) --- */
function enableDragging(svg, schema, onChange, getSelectedId, getSelectedColId, onSelectTable, onSelectColumn) {
  const drag = { active: false, id: null, offsetX: 0, offsetY: 0, pointerId: null };

  svg.addEventListener('pointerdown', (e) => {
    const target = (e.target instanceof Element) ? e.target.closest('.drag-handle') : null;
    if (!target) return;

    const group = target.closest('g.table'); if (!group) return;
    const tableId = group.getAttribute('data-id'); const table = schema.tables.find(t => t.id === tableId); if (!table) return;

    const { x: sx, y: sy } = clientToSvgPoint(svg, e.clientX, e.clientY); const { x, y } = tableGeometry(table);
    drag.active = true; drag.id = tableId; drag.offsetX = sx - x; drag.offsetY = sy - y; drag.pointerId = e.pointerId; svg.setPointerCapture(e.pointerId);

    e.stopPropagation();
    e.preventDefault();
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    const table = schema.tables.find(t => t.id === drag.id); if (!table) return;
    const { x: sx, y: sy } = clientToSvgPoint(svg, e.clientX, e.clientY);
    table.position = { x: Math.round(sx - drag.offsetX), y: Math.round(sy - drag.offsetY) };
    // IMPORTANT: keep real handlers during drag so selections stay interactive
    renderSchema(svg, schema, getSelectedId && getSelectedId(), onSelectTable, onSelectColumn, getSelectedColId && getSelectedColId());
  });

  function endDrag(e) {
    if (!drag.active) return; drag.active = false;
    try { svg.releasePointerCapture(drag.pointerId); } catch (_) { }
    drag.pointerId = null;
    onChange && onChange(schema);
    // Re-render once more with the real handlers to avoid "locked" selection
    renderSchema(svg, schema, getSelectedId && getSelectedId(), onSelectTable, onSelectColumn, getSelectedColId && getSelectedColId());
  }
  svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);
}

/* First grid spot where a new (empty) table, plus room for its toolbar, doesn't overlap existing tables */
function findFreePosition(schema) {
  const margin = 30, toolbarRoom = DIAGRAM.TOOLBAR_H + 6;
  const newH = tableGeometry({ columns: [], position: { x: 0, y: 0 } }).height;
  const boxes = schema.tables.map(tableGeometry);
  const overlaps = (x, y) => boxes.some(b =>
    x < b.x + b.width + margin && x + DIAGRAM.NODE_WIDTH + margin > b.x &&
    y - toolbarRoom < b.y + b.height + margin && y + newH + margin > b.y - toolbarRoom
  );
  const stepX = DIAGRAM.NODE_WIDTH + 60, stepY = 120;
  for (let row = 0; row < 50; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 80 + col * stepX, y = 80 + row * stepY;
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return { x: 80 + 40 * schema.tables.length, y: 80 + 40 * schema.tables.length };
}

window.Diagram = { renderSchema, enableDragging, enablePanZoom, setActions, findFreePosition };
