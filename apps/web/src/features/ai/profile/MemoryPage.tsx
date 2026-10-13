import { Toggle, cn } from '@pingo/ui';
import { Brain, FileUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { useConfirm } from '../../../components/ConfirmProvider.js';
import { saveAiPrefs, useAiPrefs } from '../room/ai-prefs.js';
import { MEMORY_CAP } from './ai-profile-model.js';
import { Card, fieldClass, SectionLabel, TopBar } from './pastel.js';
import { useAiMemories } from './useAiMemories.js';

/**
 * What PINGO AI remembers: switch it off (the chat then saves nothing new),
 * read every saved thing, delete one, add or import some, or clear them all.
 */
export function MemoryPage({ onBack }: { onBack: () => void }) {
  const confirm = useConfirm();
  const { prefs } = useAiPrefs();
  const { rows, loading, error: loadError, add, remove, clear, importText } = useAiMemories();
  const on = prefs.memory_enabled !== false;
  const [draft, setDraft] = useState('');
  const [importing, setImporting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (what: string, fn: () => Promise<string | undefined>) => {
    setBusy(what);
    setError(undefined);
    setNote(undefined);
    const err = await fn();
    setBusy(undefined);
    if (err) setError(err);
    return !err;
  };

  const doImport = async (text: string) => {
    setBusy('import');
    setError(undefined);
    setNote(undefined);
    const out = await importText(text);
    setBusy(undefined);
    if (out.error) setError(out.error);
    else {
      setNote(`Imported ${out.added} ${out.added === 1 ? 'memory' : 'memories'}.`);
      setPasted('');
      setImporting(false);
    }
  };

  return (
    <>
      <TopBar title="Memory" onBack={onBack} />
      <div className="pp-pad flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-2">
        <Card>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <Brain size={25} className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-semibold">Remember things</span>
              <span className="block text-[13.5px] text-[var(--pp-sub)]">
                {on ? 'Pingo saves what you ask it to remember and uses it later.' : 'Off. Pingo saves nothing new and does not use what is saved.'}
              </span>
            </span>
            <Toggle
              checked={on}
              onChange={(memory_enabled) => void run('toggle', () => saveAiPrefs({ memory_enabled }))}
              label="Remember things"
            />
          </div>
        </Card>

        <SectionLabel>
          <span className="mt-5 flex items-baseline justify-between">
            Saved <span className="text-[14px] font-medium tabular-nums text-[var(--pp-sub)]">{rows.length}/{MEMORY_CAP}</span>
          </span>
        </SectionLabel>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run('add', () => add(draft)).then((ok) => ok && setDraft(''));
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="Add something to remember" className={cn(fieldClass, 'h-12 flex-1')} />
          <button type="submit" aria-label="Add memory" disabled={!draft.trim() || busy === 'add'} className="grid size-12 shrink-0 place-items-center rounded-[16px] bg-[var(--pp-accent)] text-[var(--pp-accent-ink)] disabled:opacity-45">
            {busy === 'add' ? <Loader2 size={20} className="animate-spin" /> : <Plus size={22} />}
          </button>
        </form>

        <Card className="mt-3">
          {loading ? (
            <p className="flex items-center justify-center gap-2 px-4 py-6 text-[14.5px] text-[var(--pp-sub)]">
              <Loader2 size={16} className="animate-spin" aria-hidden /> Loading
            </p>
          ) : loadError ? (
            <p className="px-4 py-6 text-center text-[14.5px] text-danger">{loadError}</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-[14.5px] text-[var(--pp-sub)]">Nothing saved yet. Tell Pingo &ldquo;remember ...&rdquo; or add one above.</p>
          ) : (
            <ul className="divide-y divide-[var(--pp-line)]">
              {rows.map((m) => (
                <li key={m.id} className="flex items-start gap-2 py-1 pl-4 pr-1.5">
                  <span className="min-w-0 flex-1 py-2.5">
                    <span className="block text-[15.5px] leading-snug">{m.value}</span>
                    <span className="block text-[12.5px] text-[var(--pp-faint)]">{new Date(m.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </span>
                  <button type="button" aria-label={`Delete: ${m.value}`} onClick={() => void run(m.id, () => remove(m.id))} className="grid size-10 shrink-0 place-items-center rounded-full text-[var(--pp-sub)] active:bg-[var(--pp-field)]">
                    {busy === m.id ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={18} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="mt-3 flex gap-2.5">
          <button type="button" onClick={() => setImporting((v) => !v)} aria-expanded={importing} className="pp-card flex h-12 flex-1 items-center justify-center gap-2 text-[15.5px] font-semibold">
            <FileUp size={19} aria-hidden /> Import
          </button>
          <button
            type="button"
            disabled={!rows.length || busy === 'clear'}
            onClick={() =>
              void (async () => {
                if (!(await confirm({ title: 'Clear all memories?', description: `Pingo forgets all ${rows.length} saved ${rows.length === 1 ? 'thing' : 'things'}. This can't be undone.`, confirmLabel: 'Clear all' }))) return;
                if (await run('clear', clear)) setNote('All memories cleared.');
              })()
            }
            className="pp-card flex h-12 flex-1 items-center justify-center gap-2 text-[15.5px] font-semibold text-danger disabled:opacity-45"
          >
            <Trash2 size={18} aria-hidden /> Clear all
          </button>
        </div>

        {importing && (
          <Card className="mt-3 p-4">
            <p className="text-[14px] text-[var(--pp-sub)]">Paste one memory per line, or choose a .txt or .json file.</p>
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} placeholder={'My exam is on 4 Nov\nI am vegetarian'} className={cn(fieldClass, 'mt-2.5 resize-none py-3 leading-snug')} />
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.json,text/plain,application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                if (file.size > 200_000) return setError('That file is too big. Up to 200 KB.');
                void file.text().then(doImport);
              }}
            />
            <div className="mt-3 flex gap-2.5">
              <button type="button" onClick={() => fileRef.current?.click()} className="flex h-11 flex-1 items-center justify-center rounded-full bg-[var(--pp-field)] text-[15px] font-semibold">
                Choose file
              </button>
              <button
                type="button"
                disabled={!pasted.trim() || busy === 'import'}
                onClick={() => void doImport(pasted)}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-[var(--pp-accent)] text-[15px] font-semibold text-[var(--pp-accent-ink)] disabled:opacity-45"
              >
                {busy === 'import' && <Loader2 size={16} className="animate-spin" />} Import
              </button>
            </div>
          </Card>
        )}

        {note && <p className="mt-3 text-center text-[14px] text-[var(--pp-sub)]">{note}</p>}
        {error && (
          <p role="alert" className="mt-3 text-center text-[14px] text-danger">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
