// diagram.js
const DIAGRAM = { NODE_WIDTH: 240, ROW_H: 22, PADDING_X: 10, HEADER_H: 28, GAP: 8 };

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
  const height = DIAGRAM.HEADER_H + DIAGRAM.GAP + rows * DIAGRAM.ROW_H + DIAGRAM.GAP;
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

function renderTable(svg, table, schema, selectedTableId, selectedColId, onSelectTable, onSelectColumn) {
  const vp = ensureViewport(svg);
  const g = createSvg('g', { class: `table${table.id === selectedTableId ? ' selected' : ''}`, 'data-id': table.id });
  const { x, y, width, height } = tableGeometry(table);

  // MAIN BOX (selection only)
  const cornerR = 8;
  const rect = createSvg('rect', { x, y, rx: cornerR, ry: cornerR, width, height, fill: '#fff', stroke: '#ccc', class: 'table-box' });
  g.appendChild(rect);

  // HEADER BACKGROUND (only header changes color, with rounded top corners)
  const headerFill = getHeaderFill(table);
  const headerPath = roundedTopRectPath(x, y, width, DIAGRAM.HEADER_H, cornerR, cornerR);
  const header = createSvg('path', { d: headerPath, fill: headerFill, class: 'table-header-bg' });
  g.appendChild(header);

  // TITLE
  const title = createSvg('text', { x: x + DIAGRAM.PADDING_X, y: y + DIAGRAM.HEADER_H / 2, class: 'table-title', 'dominant-baseline': 'middle' });
  title.textContent = table.name; g.appendChild(title);

  // HEADER SEPARATOR
  g.appendChild(createSvg('line', { x1: x + 8, y1: y + DIAGRAM.HEADER_H, x2: x + width - 8, y2: y + DIAGRAM.HEADER_H, stroke: '#d1d5db', 'stroke-width': '0.5' }));

  // DRAG BUTTON (the ONLY drag handle)
  const btnSize = 16;
  const hx = x + width - DIAGRAM.PADDING_X - btnSize;
  const hy = y + (DIAGRAM.HEADER_H - btnSize) / 2;

  const dragBtn = createSvg('g', { class: 'drag-button drag-handle', transform: `translate(${hx},${hy})`, role: 'button' });
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
    const classes = ['col-text'];
    if (col.id === selectedColId) classes.push('col-editing');
    const t = createSvg('text', { x: x + DIAGRAM.PADDING_X, y: cy, class: classes.join(' '), 'data-col-id': col.id, 'dominant-baseline': 'middle' });
    t.textContent = `${prefix}${col.name}: ${col.type}${col.nullable ? '' : ' NOT NULL'}`;
    t.style.cursor = 'pointer';
    t.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelectColumn && onSelectColumn(table.id, col.id);
    });
    g.appendChild(t);
  });

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

function renderEdge(svg, fk, schema) {
  const vp = ensureViewport(svg);
  const fromTable = schema.tables.find(t => t.id === fk.from.table);
  const toTable = schema.tables.find(t => t.id === fk.to.table);
  if (!fromTable || !toTable) return;
  const fromCol = fk.from.columns[0], toCol = fk.to.columns[0];
  const fromY = columnCenterY(fromTable, fromCol), toY = columnCenterY(toTable, toCol);
  const fromX = (fromTable.position?.x || 0) + DIAGRAM.NODE_WIDTH, toX = (toTable.position?.x || 0);
  const dx = Math.max(40, Math.abs(toX - fromX) / 3);
  const d = `M ${fromX},${fromY} C ${fromX + dx},${fromY} ${toX - dx},${toY} ${toX},${toY}`;
  vp.appendChild(createSvg('path', { d, class: 'edge', 'marker-end': 'url(#arrow)' }));
}

function renderSchema(svg, schema, selectedTableId, onSelectTable, onSelectColumn, selectedColId) {
  clearDiagram(svg); ensureArrowMarker(svg); applyView(svg);
  schema.tables.forEach(t => renderTable(svg, t, schema, selectedTableId, selectedColId, onSelectTable, onSelectColumn));
  (schema.foreignKeys || []).forEach(fk => renderEdge(svg, fk, schema));
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
    const onTable = el?.closest('g.table');
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

    const { x: sx, y: sy } = clientToSvgPoint(svg, e.clientX, e.clientY); const { x, y } = table.position || { x: 0, y: 0 };
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

window.Diagram = { renderSchema, enableDragging, enablePanZoom };
