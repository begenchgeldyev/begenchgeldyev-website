# Refactor editor-script.html to a Proper State Machine

## Context

`src/components/projects/editor-script.html` manages an inline project editor (double-click to edit, toolbar formatting, save/cancel). The current code is half-baked:

- `ContentEditingStateMachine` is defined but **never instantiated** — it's dead code.
- `EditableContent` class exists but its state is not the authoritative source of truth; loose `editing` boolean and `snapshot` variables still own control flow.
- `setEditable()` references `editables` (a `const` declared 174 lines later) — works by accident because it's only called from event handlers after the declaration, but is confusing.
- Keyboard handler has an unreachable branch: `case 'Enter' && !event.shiftKey:` always evaluates to `case false:`, so `<br>` insertion never fires. The intent (plain Enter → insert `<br>`, Shift+Enter → close editor) is inverted/broken.

The goal is to consolidate everything into a single `EditorStateMachine` class that owns all state, guards all transitions, and runs all side effects.

---

## States

```
idle  ──OPEN──►  editing  ──SAVE──►  saving
  ▲                 │                  │
  └──────CANCEL─────┘       SAVE_OK ──►(reload)
                            SAVE_ERR ──► editing
```

| State     | Meaning                                                  |
|-----------|----------------------------------------------------------|
| `idle`    | Editor panel hidden, fields read-only                    |
| `editing` | Editor panel visible, fields contentEditable, toolbar on |
| `saving`  | PATCH in flight, UI disabled                             |

---

## Events / Transitions

| Event             | From      | To        | Side effects                                                   |
|-------------------|-----------|-----------|----------------------------------------------------------------|
| `OPEN(node?)`     | `idle`    | `editing` | snapshot fields, show editor, enable contentEditable, focus    |
| `CANCEL`          | `editing` | `idle`    | restore snapshot, hide editor, disable contentEditable         |
| `SAVE`            | `editing` | `saving`  | set status "Saving…", send PATCH                               |
| `SAVE_OK`         | `saving`  | `idle`    | `window.location.reload()`                                     |
| `SAVE_ERR(msg)`   | `saving`  | `editing` | set status to error message, re-enable UI                      |
| `SET_ACTIVE(node)`| `editing` | `editing` | set `activeEditable` reference                                 |
| `APPLY_CMD(cmd)`  | `editing` | `editing` | run execCommand if activeEditable === contentNode              |

---

## Implementation Plan

### File to modify
`src/components/projects/editor-script.html`

### Structure

Replace the current mix of loose variables, two unused/partial classes, and scattered handlers with a single `EditorStateMachine` class:

```js
class EditorStateMachine {
  #state = 'idle';           // 'idle' | 'editing' | 'saving'
  #snapshot = null;
  #activeEditable = null;

  // DOM refs passed in constructor
  #editor; #status; #imageInput; #hiddenInput;
  #titleNode; #descriptionNode; #contentNode;
  #previewNode; #visibilityNode;
  #editableNodes;

  constructor(refs) { /* assign refs, bind listeners */ }

  // Public entry point (kept for window.__openProjectEditor)
  open(triggerNode) { /* OPEN transition */ }

  // Private transitions
  #enterEditing(triggerNode) { ... }
  #enterIdle() { ... }
  #enterSaving() { ... }

  // Helpers
  #setEditable(enabled) { ... }
  #applyViewState() { ... }
  #normalizeContent() { ... }
  #applyCommand(command) { ... }
  #takeSnapshot() { ... }
  #restoreSnapshot() { ... }
}
```

### Key changes

1. **Delete** `ContentEditingStateMachine` and `EditableContent` classes entirely.
2. **Delete** loose `editing`, `snapshot`, `activeEditable` variables — they become private fields on `EditorStateMachine`.
3. **Fix keyboard handler**: split `Enter` vs `Shift+Enter` correctly:
   ```js
   case 'Enter':
     if (event.shiftKey) {
       // Shift+Enter → close editor
       this.#enterIdle();
     } else {
       // plain Enter → insert line break
       insertHtml('<br>');
     }
     break;
   ```
4. **Fix `setEditable` reference**: `#editableNodes` is set in the constructor before any event can fire — no more temporal dependency confusion.
5. **Guard all transitions** via `#state` check at the top of each method (e.g., `open()` is a no-op when `#state !== 'idle'`).
6. **Wire listeners** inside the constructor so the machine is self-contained.
7. **Keep** `window.__openProjectEditor = (node) => machine.open(node)` for external callers (e.g. page-level edit buttons).

### Listener wiring (inside constructor)

```js
// dblclick on editable fields → open
editableNodes.forEach(node => {
  node.addEventListener('dblclick', e => this.open(e.target.closest('[data-project-field]')));
  node.addEventListener('focus', () => this.#activeEditable = node);
  node.addEventListener('click', () => this.#activeEditable = node);
  node.addEventListener('keydown', e => this.#onKeyDown(e));
});

// Admin editable wrappers → open
document.querySelectorAll('[data-admin-editable]').forEach(n =>
  n.addEventListener('dblclick', e => this.open(e.target.closest('[data-project-field]')))
);

// Toolbar buttons
toolbarButtons.forEach(btn =>
  btn.addEventListener('click', () => this.#applyCommand(btn.dataset.editorCommand))
);

// Image input preview
imageInput.addEventListener('input', () => this.#onImageInput());

// Visibility checkbox
hiddenInput.addEventListener('change', () => this.#onHiddenChange());

// Cancel / Save
document.getElementById('project-editor-cancel')?.addEventListener('click', () => this.#enterIdle());
document.getElementById('project-editor-save')?.addEventListener('click', () => this.#enterSaving());
```

---

## Verification

1. `bun run lint` from `backend/` — no TS errors (this is a `<script>` tag, so lint is JS only).
2. `docker compose up -d` and navigate to a project page as admin.
3. Double-click a field → editor panel appears, fields highlight.
4. Type in the content field:
   - **Enter** → inserts `<br>` (line break within the field).
   - **Shift+Enter** → closes editor.
   - **Tab** → inserts two non-breaking spaces.
5. Click Cancel → fields revert to snapshot values, editor hides.
6. Edit fields, click Save → PATCH fires, page reloads with new data.
7. Open editor, click a toolbar button while not in content field → status shows hint message.
8. Open editor, focus content field, apply toolbar commands (bold, italic, h2, ul, code, link) → formatting applies.
