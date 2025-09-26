// app.js
(function () {
    const status = document.getElementById('status');
    const svg = document.getElementById('diagram');

    // Hide any existing "Save solution" buttons in the host page (header or sidebar),
    // since saves are automatic now.
    const headerSaveBtn = document.getElementById('btn-save-solution');
    if (headerSaveBtn) headerSaveBtn.style.display = 'none';

    // sidebar controls
    const sectionSelected = document.getElementById('section-selected');
    const selTitle = document.getElementById('sel-title');
    const btnDelTable = document.getElementById('btn-del-table');

    const fNewTable = document.getElementById('form-new-table');
    const ntName = document.getElementById('nt-name');

    const fRename = document.getElementById('form-rename-table');
    const rtName = document.getElementById('rt-name');
    const rtColor = document.getElementById('rt-color');

    const fNewCol = document.getElementById('form-new-col');
    const ncName = document.getElementById('nc-name');
    const ncType = document.getElementById('nc-type');
    const ncNullable = document.getElementById('nc-nullable');
    const ncDefault = document.getElementById('nc-default');
    const ncPK = document.getElementById('nc-pk');
    const ncUnique = document.getElementById('nc-unique');

    const fNewFK = document.getElementById('form-new-fk');
    const fkFromCol = document.getElementById('fk-from-col');
    const fkToTable = document.getElementById('fk-to-table');
    const fkToCol = document.getElementById('fk-to-col');
    const fkOnDelete = document.getElementById('fk-ondelete');

    const fieldFormTitle = document.getElementById('field-form-title');

    UI.fillTypeOptions(ncType);

    let schema = null;
    let selectedTableId = null;
    let selectedColId = null;

    // --- id helpers
    const uid = () => Math.random().toString(36).slice(2, 9);
    const tblId = name => `tbl_${name}_${uid()}`;
    const colId = name => `col_${name}_${uid()}`;
    const fkId = () => `fk_${uid()}`;
    function makeEmptySchema(name = 'New schema') {
        return { name, tables: [], foreignKeys: [] };
    }

    function setStatus(msg) { status.textContent = msg; }

    /* --------------------------------
       Auto-save every second to server
       -------------------------------- */
    let dirty = false;
    let lastSent = 0;

    function markDirty() { dirty = true; }

    // save to localStorage immediately; autosave loop will flush to server
    function save() {
      saveSchemaToLocalStorage(schema);
      markDirty();
    }

    setInterval(async () => {
      if (!schema) return;
      const now = Date.now();
      if (!dirty || now - lastSent < 1000) return;
      try {
        await saveSchemaToServer(schema, 'solution.json');
        lastSent = now; dirty = false;
        setStatus('Changes saved');
      } catch (e) {
        // Ignore transient failures; we'll retry next tick
        console.error(e);
        setStatus('Save failed (will retry)');
      }
    }, 250); // check 4x per second; flush at >=1s since last send

    /* --------------------------------
       Selection & UI
       -------------------------------- */
    function selectTable(id) {
      selectedTableId = id;
      selectedColId = null; // clear column selection
      const t = schema.tables.find(x => x.id === id);
      if (t) {
        sectionSelected.hidden = false;
        selTitle.textContent = `Selected: ${t.name}`;
        rtName.value = t.name;
        rtColor.value = t.color || 'white';

        // update FK dropdowns
        UI.fillColumns(fkFromCol, t);
        UI.fillTables(fkToTable, schema);
        const toTable = schema.tables.find(x => x.id === fkToTable.value) || schema.tables[0];
        fillToCols(toTable);
      } else {
        sectionSelected.hidden = true;
      }
      // Reset form title back to "Add Field" when table is (re)selected
      fieldFormTitle.textContent = 'Add Field';

      // clear FK status row in field form when switching tables
      fkStatusText.textContent = '';
      btnRemoveFK.hidden = true;

      Diagram.renderSchema(svg, schema, selectedTableId, selectTable, selectColumn, selectedColId);
    }

    function selectColumn(tableId, colId) {
      if (!tableId || !colId) return;
      selectedTableId = tableId;
      selectedColId = colId;
      const t = schema.tables.find(x => x.id === tableId);
      const c = t?.columns.find(x => x.id === colId);
      if (!t || !c) return;
      // ensure correct table is selected in UI and FK lists
      UI.fillColumns(fkFromCol, t);
      UI.fillTables(fkToTable, schema);
      const toTable = schema.tables.find(x => x.id === fkToTable.value) || schema.tables[0];
      fillToCols(toTable);

      // Load values into the "Add Field" form to EDIT
      ncName.value = c.name;
      ncType.value = UI.TYPES.includes(c.type) ? c.type : UI.TYPES[0];
      ncNullable.checked = !!c.nullable;
      ncDefault.value = c.default ?? '';
      ncPK.checked = (t.primaryKey || []).includes(c.id);
      ncUnique.checked = !!(t.uniqueConstraints || []).some(uq => (uq.columns || []).includes(c.id));
      // Switch buttons to edit mode label
      btnAddOrUpdateCol.textContent = 'Save Field';
      btnDeleteCol.removeAttribute('hidden');

      // Update titles
      selTitle.textContent = `Selected: ${t.name}`;
      fieldFormTitle.textContent = `Editing “${c.name}” field`;

      // Initialize color selector when entering via column edit too
      rtColor.value = t.color || 'white';

      // Show outgoing FK status (if any) for this column
      const outgoingFK = (schema.foreignKeys || []).find(fk =>
        fk.from.table === t.id && fk.from.columns.includes(c.id)
      );
      if (outgoingFK) {
        const toTbl = schema.tables.find(tt => tt.id === outgoingFK.to.table);
        const toCol = toTbl?.columns.find(cc => cc.id === outgoingFK.to.columns[0]);
        const toLabel = toTbl && toCol ? `${toTbl.name}.${toCol.name}` : '(unknown)';
        fkStatusText.textContent = `FK → ${toLabel}`;
        btnRemoveFK.hidden = false;
      } else {
        fkStatusText.textContent = '';
        btnRemoveFK.hidden = true;
      }

      Diagram.renderSchema(svg, schema, selectedTableId, selectTable, selectColumn, selectedColId);
    }

    function fillToCols(table) {
      UI.fillColumns(fkToCol, table);
    }

    // change target columns list when table changes
    fkToTable.addEventListener('change', () => {
      const t = schema.tables.find(x => x.id === fkToTable.value);
      fillToCols(t);
    });

    // --- CRUD Ops
    function ensureUniqueTableName(name) {
      const base = name; let i = 1; let nm = base;
      while (schema.tables.some(t => t.name === nm)) { nm = `${base}_${i++}`; }
      return nm;
    }

    function addTable(name) {
      const clean = name.trim();
      if (!clean) return;
      const uniqueName = ensureUniqueTableName(clean);
      const t = {
        id: tblId(uniqueName),
        name: uniqueName,
        columns: [],
        primaryKey: [],
        uniqueConstraints: [],
        indexes: [],
        position: { x: 80 + 40 * schema.tables.length, y: 80 + 40 * schema.tables.length },
        color: 'white' // default color
      };
      schema.tables.push(t);
      save(); setStatus(`Added table "${uniqueName}"`);
      selectTable(t.id);
    }

    function renameTable(id, newName) {
      const t = schema.tables.find(x => x.id === id); if (!t) return;
      const clean = newName.trim(); if (!clean) return;
      if (schema.tables.some(x => x.id !== id && x.name === clean)) {
        setStatus('Name already used'); return;
      }
      t.name = clean; save(); selectTable(id);
    }

    function setTableColor(id, colorKey) {
      const t = schema.tables.find(x => x.id === id); if (!t) return;
      // guard against unknown values
      const allowed = new Set(['white','blue','green','red']);
      t.color = allowed.has(colorKey) ? colorKey : 'white';
      save();
      Diagram.renderSchema(svg, schema, selectedTableId, selectTable, selectColumn, selectedColId);
    }

    function deleteTable(id) {
      const idx = schema.tables.findIndex(t => t.id === id); if (idx < 0) return;
      const table = schema.tables[idx];
      // remove FKs referencing or from this table
      schema.foreignKeys = (schema.foreignKeys || []).filter(fk =>
        fk.from.table !== table.id && fk.to.table !== table.id
      );
      schema.tables.splice(idx, 1);
      if (selectedTableId === id) { selectedTableId = null; selectedColId = null; }
      save(); setStatus('Table deleted'); selectTable(selectedTableId);
    }

    function addColumn(tableId, { name, type, nullable, def, pk, unique }) {
      const t = schema.tables.find(x => x.id === tableId); if (!t) return;
      let base = name.trim(); if (!base) return;
      // ensure unique per table
      let nm = base, i = 1;
      while (t.columns.some(c => c.name === nm)) nm = `${base}_${i++}`;
      const id = colId(nm);
      const col = { id, name: nm, type, nullable: !!nullable, default: def || null };
      t.columns.push(col);
      if (pk) {
        if (!t.primaryKey.includes(id)) t.primaryKey.push(id);
        col.nullable = false;
      }
      if (unique) {
        t.uniqueConstraints.push({ id: `uq_${uid()}`, columns: [id] });
      }
      save(); selectTable(tableId);
    }

    function updateColumn(tableId, colId, { name, type, nullable, def, pk, unique }) {
      const t = schema.tables.find(x => x.id === tableId); if (!t) return;
      const c = t.columns.find(x => x.id === colId); if (!c) return;
      const cleanName = name.trim(); if (!cleanName) return;

      // if name changes, keep unique within table (except self)
      let finalName = cleanName;
      if (c.name !== cleanName) {
        let i = 1;
        while (t.columns.some(x => x.id !== c.id && x.name === finalName)) finalName = `${cleanName}_${i++}`;
      }
      c.name = finalName;
      c.type = type;
      c.nullable = !!nullable;
      c.default = (def || '').trim() || null;

      // PK update
      t.primaryKey = (t.primaryKey || []).filter(id => id !== c.id);
      if (pk) {
        t.primaryKey.push(c.id);
        c.nullable = false;
      }

      // Unique (single-column UQs only here)
      t.uniqueConstraints = (t.uniqueConstraints || []).filter(uq => !(uq.columns || []).includes(c.id));
      if (unique) {
        t.uniqueConstraints.push({ id: `uq_${uid()}`, columns: [c.id] });
      }

      save(); selectColumn(tableId, colId);
    }

    function deleteColumn(tableId, colId) {
      const t = schema.tables.find(x => x.id === tableId); if (!t) return;
      const idx = t.columns.findIndex(x => x.id === colId); if (idx < 0) return;

      // remove PK ref
      t.primaryKey = (t.primaryKey || []).filter(id => id !== colId);
      // remove unique refs
      t.uniqueConstraints = (t.uniqueConstraints || []).filter(uq => !(uq.columns || []).includes(colId));
      // remove FKs referencing this column
      schema.foreignKeys = (schema.foreignKeys || []).filter(fk =>
        !(fk.from.table === tableId && fk.from.columns.includes(colId)) &&
        !(fk.to.table === tableId && fk.to.columns.includes(colId))
      );
      t.columns.splice(idx, 1);
      selectedColId = null;
      save(); selectTable(tableId);
    }

    function addForeignKey(fromTableId, fromColId, toTableId, toColId, onDelete) {
      schema.foreignKeys = schema.foreignKeys || [];
      schema.foreignKeys.push({
        id: fkId(),
        from: { table: fromTableId, columns: [fromColId] },
        to: { table: toTableId, columns: [toColId] },
        onDelete, onUpdate: 'NO ACTION'
      });
      save(); selectTable(fromTableId);
    }

    // helper to remove outgoing FK(s) from a specific field
    function removeForeignKeyForField(fromTableId, fromColId) {
      if (!schema?.foreignKeys) return;
      const before = schema.foreignKeys.length;
      schema.foreignKeys = schema.foreignKeys.filter(fk =>
        !(fk.from.table === fromTableId && fk.from.columns.includes(fromColId))
      );
      const removed = before - schema.foreignKeys.length;
      if (removed > 0) {
        save();
        setStatus(`Removed ${removed} foreign key${removed > 1 ? 's' : ''} from field`);
      } else {
        setStatus('No foreign key to remove for this field');
      }
      // stay in edit mode for this column so the user sees the result
      selectColumn(fromTableId, fromColId);
    }

    // --- Wire UI (tables)
    fNewTable.addEventListener('submit', (e) => {
      e.preventDefault(); addTable(ntName.value); ntName.value = '';
    });

    fRename.addEventListener('submit', (e) => {
      e.preventDefault(); if (!selectedTableId) return; renameTable(selectedTableId, rtName.value);
    });

    // color change handler
    rtColor.addEventListener('change', () => {
      if (!selectedTableId) return;
      setTableColor(selectedTableId, rtColor.value);
    });

    btnDelTable.addEventListener('click', () => {
      if (!selectedTableId) return;
      if (confirm('Delete this table? This will also remove related foreign keys.')) deleteTable(selectedTableId);
    });

    // --- FIELD form: we’ll dynamically add an "Update/Delete" UX without changing HTML
    const btnRow = document.createElement('div');
    btnRow.className = 'row';
    const btnAddOrUpdateCol = document.createElement('button');
    btnAddOrUpdateCol.type = 'submit';
    btnAddOrUpdateCol.textContent = 'Add Field'; // flips to "Save Field" in edit mode
    const btnDeleteCol = document.createElement('button');
    btnDeleteCol.type = 'button';
    btnDeleteCol.className = 'danger';
    btnDeleteCol.textContent = 'Delete Field';
    btnDeleteCol.hidden = true; // only visible when editing
    btnRow.appendChild(btnAddOrUpdateCol);
    btnRow.appendChild(btnDeleteCol);
    fNewCol.appendChild(btnRow);

    /* NEW: FK status + remove button (only visible when the selected column has an outgoing FK) */
    const fkStatusWrap = document.createElement('div');
    fkStatusWrap.className = 'row-between';
    fkStatusWrap.style.marginTop = '.25rem';

    const fkStatusText = document.createElement('div');
    fkStatusText.id = 'fk-status-text';
    fkStatusText.style.fontSize = '.9rem';
    fkStatusText.style.color = 'var(--muted)';
    fkStatusText.textContent = '';

    const btnRemoveFK = document.createElement('button');
    btnRemoveFK.type = 'button';
    btnRemoveFK.className = 'danger';
    btnRemoveFK.textContent = 'Remove FK';
    btnRemoveFK.hidden = true;

    fkStatusWrap.appendChild(fkStatusText);
    fkStatusWrap.appendChild(btnRemoveFK);
    fNewCol.appendChild(fkStatusWrap);

    fNewCol.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!selectedTableId) return;
      const data = {
        name: ncName.value,
        type: ncType.value,
        nullable: ncNullable.checked,
        def: (ncDefault.value || '').trim() || null,
        pk: ncPK.checked,
        unique: ncUnique.checked
      };
      if (selectedColId) {
        updateColumn(selectedTableId, selectedColId, data);
      } else {
        addColumn(selectedTableId, data);
      }
      // reset a bit (back to "add" mode)
      clearFieldForm();
    });

    btnDeleteCol.addEventListener('click', () => {
      if (!selectedTableId || !selectedColId) return;
      if (confirm('Delete this field? This also removes related constraints/keys.')) {
        deleteColumn(selectedTableId, selectedColId);
        clearFieldForm();
      }
    });

    // remove-FK handler
    btnRemoveFK.addEventListener('click', () => {
      if (!selectedTableId || !selectedColId) return;
      if (confirm('Remove the foreign key from this field?')) {
        removeForeignKeyForField(selectedTableId, selectedColId);
      }
    });

    function clearFieldForm() {
      selectedColId = null;
      ncName.value = '';
      ncPK.checked = false; ncUnique.checked = false; ncNullable.checked = false; ncDefault.value = '';
      btnAddOrUpdateCol.textContent = 'Add Field';
      btnDeleteCol.hidden = true;
      fieldFormTitle.textContent = 'Add Field';
      // clear FK status UI
      fkStatusText.textContent = '';
      btnRemoveFK.hidden = true;
      // Re-render to drop highlight on previously edited column
      Diagram.renderSchema(svg, schema, selectedTableId, selectTable, selectColumn, selectedColId);
    }

    // --- FK form
    fNewFK.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!selectedTableId) return;
      const fromCol = fkFromCol.value;
      const toTbl = fkToTable.value;
      const toCol = fkToCol.value;
      if (!fromCol || !toTbl || !toCol) return;
      addForeignKey(selectedTableId, fromCol, toTbl, toCol, fkOnDelete.value || 'NO ACTION');
    });

    // click empty canvas to clear selection (and exit column edit mode)
    svg.addEventListener('click', () => { selectTable(null); clearFieldForm(); });

    // --- Initialize Help Modal
    (async function initHelpModal() {
      try {
        const helpContent = await fetch('./help-content.html').then(r => r.text());
        HelpModal.init({
          triggerSelector: '#btn-help',
          content: helpContent,
          theme: 'auto'
        });
      } catch (e) {
        console.warn('Failed to load help content:', e);
      }
    })();

    // --- Theme change detection ---
    function setupThemeChangeListener() {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

      function handleThemeChange() {
        // Re-render the diagram when theme changes to update table colors
        if (schema) {
          Diagram.renderSchema(svg, schema, selectedTableId, selectTable, selectColumn, selectedColId);
        }
      }

      // Listen for theme changes
      mediaQuery.addEventListener('change', handleThemeChange);

      // Also listen for the older 'addListener' method for broader browser support
      if (mediaQuery.addListener) {
        mediaQuery.addListener(handleThemeChange);
      }
    }

    // --- boot
    (async function init() {
      try {
        schema = loadSchemaFromLocalStorage();

        if (!schema) {
            // If not in localStorage, try the file, but fall back to empty if missing.
            try {
                schema = await loadSchemaFromFile('initial_state.json');
                if (!schema) throw new Error('initial_state.json returned empty');
                setStatus(`Loaded: ${schema.name}`);
            } catch (err) {
                console.warn('initial_state.json not found or failed to load. Starting empty.', err);
                schema = makeEmptySchema('Untitled schema');
                setStatus('Starting with a new schema');
            }
            } else {
            setStatus(`Loaded: ${schema.name}`);
        }

        schema.foreignKeys = schema.foreignKeys || [];
        setStatus(`Loaded: ${schema.name}`);
        save();

        // Render & interactions
        Diagram.renderSchema(svg, schema, selectedTableId, selectTable, selectColumn, selectedColId);
        // Pass selection callbacks into dragging so renders keep handlers
        Diagram.enableDragging(svg, schema, save, () => selectedTableId, () => selectedColId, selectTable, selectColumn);
        Diagram.enablePanZoom(svg, () => { /* persist view? not necessary */ });

        // Setup theme change detection
        setupThemeChangeListener();

        // Pre-populate FK target selects
        UI.fillTables(fkToTable, schema);
        const first = schema.tables[0];
        if (first) { selectTable(first.id); } else { sectionSelected.hidden = true; }
      } catch (e) {
        console.error(e); setStatus('Failed to load schema.');
      }
    })();
  })();
