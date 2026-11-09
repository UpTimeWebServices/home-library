/**
 * Browser widget: mark one copy as a special edition, first edition and/or signed, plus a note.
 * Toggles save as soon as they're tapped; the note saves on its button. Used on the Verify
 * scan result and on each copy of the book page.
 */
export interface CopyFlags { id: number; special: 'none' | 'suspected' | 'confirmed'; first_edition: number; signed: number; notes: string | null }

const esc = (s: string | null) => (s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const toggle = (key: string, label: string, on: boolean) =>
  `<button type="button" data-flag="${key}" aria-pressed="${on}"
     class="rounded-full border px-3 py-1.5 text-sm font-medium transition-colors aria-pressed:border-green aria-pressed:bg-green aria-pressed:text-paper border-rule bg-paper text-ink">
     <span aria-hidden="true" class="mr-1">${on ? '✓' : '+'}</span>${label}</button>`;

export function copyFlagsHtml(f: CopyFlags): string {
  return `<div data-copy-flags="${f.id}">
    ${f.special === 'suspected' ? `<p data-suspect class="mb-2 text-sm text-brass">The catalog flagged this as possibly a special edition. Tap Special edition if it is, or <button type="button" data-flag="clear" class="underline">it isn't</button>.</p>` : ''}
    <div class="flex flex-wrap gap-2">
      ${toggle('special', 'Special edition', f.special === 'confirmed')}
      ${toggle('firstEdition', 'First edition', !!f.first_edition)}
      ${toggle('signed', 'Signed', !!f.signed)}
    </div>
    <div class="mt-2 flex gap-2">
      <input data-note value="${esc(f.notes)}" maxlength="1000" placeholder="Note, e.g. signed to Darlene, 112/500, Juniper jacket"
        class="h-10 min-w-0 flex-1 rounded-lg border border-rule bg-paper px-3 text-base" />
      <button type="button" data-save-note hidden class="rounded-lg border border-green px-3 text-sm font-medium text-green">Save</button>
    </div>
    <p data-msg class="mt-1 text-xs text-ink-soft" aria-live="polite"></p>
  </div>`;
}

export function wireCopyFlags(root: ParentNode, onChange?: (f: CopyFlags) => void): void {
  root.querySelectorAll<HTMLElement>('[data-copy-flags]').forEach((box) => {
    if (box.dataset.wired) return;
    box.dataset.wired = '1';
    const id = box.dataset.copyFlags;
    const msg = box.querySelector<HTMLElement>('[data-msg]')!;
    const note = box.querySelector<HTMLInputElement>('[data-note]')!;
    const saveNote = box.querySelector<HTMLButtonElement>('[data-save-note]')!;

    async function save(body: Record<string, unknown>) {
      msg.textContent = 'Saving…';
      const res = await fetch(`/api/copies/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { msg.textContent = 'Could not save. Try again.'; return null; }
      const f = (await res.json()) as CopyFlags;
      msg.textContent = 'Saved';
      onChange?.(f);
      return f;
    }

    box.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-flag]');
      if (!b) return;
      const key = b.dataset.flag!;
      if (key === 'clear') {
        if (await save({ special: 'none' })) box.querySelector('[data-suspect]')?.remove();
        return;
      }
      const on = b.getAttribute('aria-pressed') !== 'true';
      const f = await save({ [key]: key === 'special' ? (on ? 'confirmed' : 'none') : on });
      if (!f) return;
      b.setAttribute('aria-pressed', String(on));
      b.querySelector('span')!.textContent = on ? '✓' : '+';
      if (key === 'special') box.querySelector('[data-suspect]')?.remove();
    });
    note.addEventListener('input', () => (saveNote.hidden = false));
    const commit = async () => { if (!saveNote.hidden && (await save({ notes: note.value }))) saveNote.hidden = true; };
    saveNote.addEventListener('click', commit);
    note.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void commit(); } });
  });
}
