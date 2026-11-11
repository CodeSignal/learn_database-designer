// app.js
(function () {
    const status = document.getElementById('status');
    const svg = document.getElementById('diagram');

    // Hide any existing "Save solution" buttons in the host page,
    // since saves are automatic now.
    const headerSaveBtn = document.getElementById('btn-save-solution');
    if (headerSaveBtn) headerSaveBtn.style.display = 'none';

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
       Selection
       -------------------------------- */
    function render() {
      Diagram.renderSchema(svg, schema, selectedTableId, selectTable, selectColumn, selectedColId);
    }

    function selectTable(id) {
      selectedTableId = schema.tables.some(t => t.id === id) ? id : null;
      selectedColId = null;
      render();
    }

    function selectColumn(tableId, colId) {
      const t = schema.tables.find(x => x.id === tableId);
      if (!t || !t.columns.some(c => c.id === colId)) return;
      selectedTableId = tableId;
      selectedColId = colId;
      render();
    }

    // --- CRUD Ops
    function ensureUniqueTableName(name) {
      const base = name; let i = 1; let nm = base;
      while (schema.tables.some(t => t.name === nm)) { nm = `${base}_${i++}`; }
      return nm;
    }

    function normalizeColor(colorKey) {
      return UI.TABLE_COLOR_KEYS.includes(colorKey) ? colorKey : 'white';
    }

    function addTable(name, color = 'white') {
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
        position: Diagram.findFreePosition(schema),
        color: normalizeColor(color)
      };
      schema.tables.push(t);
      save(); setStatus(`Added table "${uniqueName}"`);
      selectTable(t.id);
    }

    function updateTable(id, { name, color }) {
      const t = schema.tables.find(x => x.id === id); if (!t) return;
      const clean = name.trim(); if (!clean) return;
      t.name = clean;
      t.color = normalizeColor(color);
      save(); setStatus(`Saved table "${clean}"`);
      selectTable(id);
    }

    function setTableColor(id, colorKey) {
      const t = schema.tables.find(x => x.id === id); if (!t) return;
      t.color = normalizeColor(colorKey);
      save();
      render();
    }

    function deleteTable(id) {
      const idx = schema.tables.findIndex(t => t.id === id); if (idx < 0) return;
      const table = schema.tables[idx];
      // remove FKs referencing or from this table
      schema.foreignKeys = (schema.foreignKeys || []).filter(fk =>
        fk.from.table !== table.id && fk.to.table !== table.id
      );
      schema.tables.splice(idx, 1);
      save(); setStatus('Table deleted');
      selectTable(null);
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
      save(); selectTable(tableId);
    }

    // a field can have several outgoing FKs (schemas saved by the old sidebar could); every operation
    // below touches exactly one FK, by id, so the others are kept
    function outgoingForeignKeys(tableId, colId) {
      return (schema.foreignKeys || []).filter(fk => fk.from.table === tableId && fk.from.columns.includes(colId));
    }

    function isSameForeignKey(fk, fromTableId, fromColId, toTableId, toColId) {
      return fk.from.table === fromTableId && fk.from.columns.length === 1 && fk.from.columns[0] === fromColId &&
        fk.to.table === toTableId && fk.to.columns.length === 1 && fk.to.columns[0] === toColId;
    }

    // add a new FK from a field (editFkId = null), or update one existing FK in place.
    // Multi-column FKs keep their columns; only onDelete changes.
    function saveForeignKey(editFkId, fromTableId, fromColId, toTableId, toColId, onDelete) {
      const existing = editFkId ? schema.foreignKeys.find(fk => fk.id === editFkId) : null;
      if (existing) {
        existing.onDelete = onDelete;
        if (existing.from.columns.length === 1) existing.to = { table: toTableId, columns: [toColId] };
      } else {
        schema.foreignKeys.push({
          id: fkId(),
          from: { table: fromTableId, columns: [fromColId] },
          to: { table: toTableId, columns: [toColId] },
          onDelete, onUpdate: 'NO ACTION'
        });
      }
      save(); setStatus('Foreign key saved');
      selectColumn(fromTableId, fromColId);
    }

    function removeForeignKey(id, fromTableId, fromColId) {
      const before = schema.foreignKeys.length;
      schema.foreignKeys = schema.foreignKeys.filter(fk => fk.id !== id);
      if (schema.foreignKeys.length < before) {
        save(); setStatus('Foreign key removed');
      }
      selectColumn(fromTableId, fromColId);
    }

    // click empty canvas to clear selection
    svg.addEventListener('click', () => selectTable(null));

    function wireDialogClose(dialog, cancelBtn, onClose) {
      cancelBtn.addEventListener('click', () => dialog.close());
      // clicking the backdrop (the dialog element itself, outside the form) closes it
      dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
      dialog.addEventListener('close', onClose);
    }

    // --- Table pop-up (create from the canvas corner button, or edit from the table toolbar)
    const tableDialog = document.getElementById('table-dialog');
    const tdForm = document.getElementById('table-dialog-form');
    const tdTitle = document.getElementById('td-title');
    const tdName = document.getElementById('td-name');
    const tdSubmit = document.getElementById('td-submit');

    let tableDialogTarget = null; // table id when editing, null when creating

    function openTableDialog(editTableId = null) {
      const t = editTableId ? schema.tables.find(x => x.id === editTableId) : null;
      tableDialogTarget = t ? t.id : null;
      tdForm.reset();
      tdName.setCustomValidity('');
      tdTitle.textContent = t ? `Edit table “${t.name}”` : 'New table';
      tdSubmit.textContent = t ? 'Save Table' : 'Create Table';
      if (t) {
        tdName.value = t.name;
        const radio = tdForm.querySelector(`input[name="td-color"][value="${normalizeColor(t.color)}"]`);
        if (radio) radio.checked = true;
      }
      tableDialog.showModal();
      tdName.focus();
    }

    document.getElementById('btn-new-table').addEventListener('click', () => openTableDialog());
    tdName.addEventListener('input', () => tdName.setCustomValidity(''));
    tdForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const color = tdForm.querySelector('input[name="td-color"]:checked')?.value || 'white';
      const editId = tableDialogTarget;
      const clean = tdName.value.trim();
      if (!clean) {
        tdName.setCustomValidity('Enter a table name');
        tdName.reportValidity();
        return;
      }
      if (editId) {
        if (schema.tables.some(x => x.id !== editId && x.name === clean)) {
          tdName.setCustomValidity('A table with this name already exists');
          tdName.reportValidity();
          return;
        }
        tableDialog.close();
        updateTable(editId, { name: clean, color });
      } else {
        tableDialog.close();
        addTable(clean, color);
      }
    });
    wireDialogClose(tableDialog, document.getElementById('td-cancel'), () => { tableDialogTarget = null; });

    // --- Field pop-up (add/edit a field from the diagram)
    const fieldDialog = document.getElementById('field-dialog');
    const fdForm = document.getElementById('field-dialog-form');
    const fdTitle = document.getElementById('fd-title');
    const fdName = document.getElementById('fd-name');
    const fdType = document.getElementById('fd-type');
    const fdNullable = document.getElementById('fd-nullable');
    const fdDefault = document.getElementById('fd-default');
    const fdPK = document.getElementById('fd-pk');
    const fdUnique = document.getElementById('fd-unique');
    const fdSubmit = document.getElementById('fd-submit');
    const fdCancel = document.getElementById('fd-cancel');
    UI.fillTypeOptions(fdType);

    let fieldDialogTarget = null; // { tableId, colId } — colId is null when adding

    function openFieldDialog(tableId, editColId = null) {
      const t = schema.tables.find(x => x.id === tableId); if (!t) return;
      const c = editColId ? t.columns.find(x => x.id === editColId) : null;
      fieldDialogTarget = { tableId, colId: c ? c.id : null };
      fdTitle.textContent = c ? `Edit “${c.name}” in ${t.name}` : `Add field to ${t.name}`;
      fdSubmit.textContent = c ? 'Save Field' : 'Add Field';
      fdName.value = c?.name ?? '';
      fdName.setCustomValidity('');
      fdType.value = c && UI.TYPES.includes(c.type) ? c.type : UI.TYPES[0];
      fdNullable.checked = !!c?.nullable;
      fdDefault.value = c?.default ?? '';
      fdPK.checked = !!c && (t.primaryKey || []).includes(c.id);
      fdUnique.checked = !!c && (t.uniqueConstraints || []).some(uq => (uq.columns || []).includes(c.id));
      fieldDialog.showModal();
      fdName.focus();
    }

    fdName.addEventListener('input', () => fdName.setCustomValidity(''));
    fdForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!fieldDialogTarget) return;
      const name = fdName.value.trim();
      if (!name) {
        fdName.setCustomValidity('Enter a field name');
        fdName.reportValidity();
        return;
      }
      const { tableId, colId: editColId } = fieldDialogTarget;
      const data = {
        name,
        type: fdType.value,
        nullable: fdNullable.checked,
        def: (fdDefault.value || '').trim() || null,
        pk: fdPK.checked,
        unique: fdUnique.checked
      };
      fieldDialog.close();
      if (editColId) updateColumn(tableId, editColId, data);
      else addColumn(tableId, data);
    });
    wireDialogClose(fieldDialog, fdCancel, () => { fieldDialogTarget = null; });

    // --- Foreign key pop-up (add, change or remove one of the selected field's FKs)
    const fkDialog = document.getElementById('fk-dialog');
    const fkdForm = document.getElementById('fk-dialog-form');
    const fkdTitle = document.getElementById('fkd-title');
    const fkdCurrent = document.getElementById('fkd-current');
    const fkdKeyWrap = document.getElementById('fkd-key-wrap');
    const fkdKey = document.getElementById('fkd-key');
    const fkdToTable = document.getElementById('fkd-to-table');
    const fkdToCol = document.getElementById('fkd-to-col');
    const fkdOnDelete = document.getElementById('fkd-ondelete');
    const fkdRemove = document.getElementById('fkd-remove');
    const fkdSubmit = document.getElementById('fkd-submit');
    const fkdCancel = document.getElementById('fkd-cancel');

    let fkDialogTarget = null; // { tableId, colId } of the source field

    function fillFkTargetCols(toTableId, preferredColId) {
      const t = schema.tables.find(x => x.id === toTableId);
      UI.fillColumns(fkdToCol, t);
      const fallback = (t?.primaryKey || [])[0];
      const pick = [preferredColId, fallback].find(id => id && t?.columns.some(c => c.id === id));
      if (pick) fkdToCol.value = pick;
    }

    function describeFk(fk) {
      const colName = (tbl, id) => tbl?.columns.find(c => c.id === id)?.name ?? '?';
      const fromTbl = schema.tables.find(x => x.id === fk.from.table);
      const toTbl = schema.tables.find(x => x.id === fk.to.table);
      const toName = toTbl?.name ?? '(unknown)';
      if (fk.from.columns.length === 1) return `→ ${toName}.${colName(toTbl, fk.to.columns[0])}`;
      const list = (tbl, ids) => ids.map(id => colName(tbl, id)).join(', ');
      return `(${list(fromTbl, fk.from.columns)}) → ${toName}(${list(toTbl, fk.to.columns)})`;
    }

    // fill the form from the key chosen in the "Key" select ('' = a new key)
    function loadFkIntoForm() {
      const { tableId, colId } = fkDialogTarget;
      const fk = fkdKey.value ? schema.foreignKeys.find(x => x.id === fkdKey.value) : null;
      const composite = !!fk && fk.from.columns.length > 1;
      const count = outgoingForeignKeys(tableId, colId).length;
      const notes = [];
      if (count > 1) notes.push(`This field has ${count} foreign keys. Changes apply only to the selected key; the others are kept.`);
      if (composite) notes.push('This is a multi-column key, so only On Delete can be changed here.');
      fkdCurrent.textContent = notes.join(' ');
      fkdCurrent.hidden = notes.length === 0;
      fkdToCol.setCustomValidity('');

      if (fk) {
        fkdToTable.value = fk.to.table;
        const idx = Math.max(0, fk.from.columns.indexOf(colId));
        fillFkTargetCols(fk.to.table, fk.to.columns[idx]);
        fkdOnDelete.value = fk.onDelete || 'NO ACTION';
      } else {
        const other = schema.tables.find(x => x.id !== tableId) || schema.tables.find(x => x.id === tableId);
        fkdToTable.value = other.id;
        fillFkTargetCols(other.id);
        fkdOnDelete.value = 'NO ACTION';
      }
      fkdToTable.disabled = fkdToCol.disabled = composite;
      fkdRemove.hidden = !fk;
      fkdSubmit.textContent = fk ? 'Save FK' : 'Add FK';
    }

    function openFkDialog(tableId, fieldId) {
      const t = schema.tables.find(x => x.id === tableId);
      const c = t?.columns.find(x => x.id === fieldId);
      if (!t || !c) return;
      fkDialogTarget = { tableId, colId: c.id };
      const outgoing = outgoingForeignKeys(t.id, c.id);

      fkdTitle.textContent = `Foreign key from ${t.name}.${c.name}`;
      UI.fillTables(fkdToTable, schema);
      fkdKey.innerHTML = '';
      outgoing.forEach(fk => fkdKey.add(new Option(describeFk(fk), fk.id)));
      fkdKey.add(new Option('+ New foreign key', ''));
      fkdKey.value = outgoing[0]?.id ?? '';
      fkdKeyWrap.hidden = outgoing.length === 0;
      loadFkIntoForm();
      fkDialog.showModal();
    }

    fkdKey.addEventListener('change', loadFkIntoForm);
    fkdToTable.addEventListener('change', () => { fkdToCol.setCustomValidity(''); fillFkTargetCols(fkdToTable.value); });
    fkdToCol.addEventListener('change', () => fkdToCol.setCustomValidity(''));

    fkdForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!fkDialogTarget || !fkdToTable.value || !fkdToCol.value) return;
      const { tableId, colId: fromColId } = fkDialogTarget;
      const editFkId = fkdKey.value || null;
      const editing = editFkId ? schema.foreignKeys.find(fk => fk.id === editFkId) : null;
      const toTableId = fkdToTable.value, toColId = fkdToCol.value;
      const retargets = !editing || editing.from.columns.length === 1;
      if (retargets && schema.foreignKeys.some(fk => fk !== editing && isSameForeignKey(fk, tableId, fromColId, toTableId, toColId))) {
        fkdToCol.setCustomValidity('This field already has a foreign key to this column');
        fkdToCol.reportValidity();
        return;
      }
      fkDialog.close();
      saveForeignKey(editFkId, tableId, fromColId, toTableId, toColId, fkdOnDelete.value || 'NO ACTION');
    });
    fkdRemove.addEventListener('click', () => {
      if (!fkDialogTarget || !fkdKey.value) return;
      const { tableId, colId: fromColId } = fkDialogTarget;
      const id = fkdKey.value;
      fkDialog.close();
      removeForeignKey(id, tableId, fromColId);
    });
    wireDialogClose(fkDialog, fkdCancel, () => { fkDialogTarget = null; });

    // --- On-canvas controls (rendered by diagram.js)
    Diagram.setActions({
      onAddField: (tableId) => openFieldDialog(tableId),
      onEditField: (tableId, cId) => openFieldDialog(tableId, cId),
      onForeignKey: (tableId, cId) => openFkDialog(tableId, cId),
      onDeleteField: (tableId, cId) => {
        if (confirm('Delete this field? This also removes related constraints/keys.')) deleteColumn(tableId, cId);
      },
      onEditTable: (tableId) => openTableDialog(tableId),
      onDeleteTable: (tableId) => {
        if (confirm('Delete this table? This will also remove related foreign keys.')) deleteTable(tableId);
      },
      onColorTable: (tableId, color) => setTableColor(tableId, color)
    });

    // --- Initialize Help Modal
    (async function initHelpModal() {
      try {
        const helpContent = await fetch('./help-content.html', { cache: 'no-store' }).then(r => r.text());
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
        if (schema) render();
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
        render();
        // Pass selection callbacks into dragging so renders keep handlers
        Diagram.enableDragging(svg, schema, save, () => selectedTableId, () => selectedColId, selectTable, selectColumn);
        Diagram.enablePanZoom(svg, () => { /* persist view? not necessary */ });

        // Setup theme change detection
        setupThemeChangeListener();

        const first = schema.tables[0];
        if (first) selectTable(first.id);
      } catch (e) {
        console.error(e); setStatus('Failed to load schema.');
      }
    })();
  })();
