import { useChat, type Post, type Profile } from '@pingo/core';
import { Check, CirclePlus, Download, Link as LinkIcon, Search, Send, Share, Star } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { saveImage } from '../native/save-image.js';
import { profileLink } from './ShareProfileSheet.js';

/**
 * Share on a post, Instagram's sheet: search, the people you talk to, and a row
 * of actions along the foot - Add to story first. Picking people swaps that row
 * for a message and Send.
 */
export function SharePostSheet({ post, author, onClose, onAddToStory, onNote }: {
  post: Post;
  author: Profile;
  onClose: () => void;
  /** Close friends is the same editor, with the story going to your list. */
  onAddToStory: (audience: 'friends' | 'close') => void;
  /** A one-line confirmation, shown by the post. */
  onNote: (text: string, icon: React.ReactNode) => void;
}) {
  const { conversations, service: chat } = useChat();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [closing, setClosing] = useState(false);
  const drag = useRef<{ y: number; dy: number } | undefined>(undefined);
  const sheet = useRef<HTMLDivElement>(null);
  const link = profileLink(author.username);

  const people = useMemo(() => conversations
    .filter((c) => c.kind === 'direct' || c.kind === 'group')
    // Not back to the person whose post it is, as Instagram leaves them out.
    .filter((c) => !(c.kind === 'direct' && c.participantIds.includes(author.id)))
    .filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 40), [conversations, q, author.id]);

  const close = (then?: () => void) => {
    setClosing(true);
    window.setTimeout(() => { onClose(); then?.(); }, 260);
  };
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const send = () => {
    const ids = [...picked]; const body = [message.trim(), link].filter(Boolean).join('\n');
    close(() => onNote(`Sent to ${ids.length}`, <Send />));
    void Promise.all(ids.map((conversationId) => chat.sendMessage({ conversationId, body }))).catch(() => onNote('That did not send', <Send />));
  };

  const act = async (a: 'story' | 'cf' | 'copy' | 'share' | 'dl') => {
    if (a === 'story' || a === 'cf') return close(() => onAddToStory(a === 'cf' ? 'close' : 'friends'));
    close();
    if (a === 'copy') {
      try { await navigator.clipboard.writeText(link); onNote('Link copied', <LinkIcon />); } catch { onNote('Could not copy the link', <LinkIcon />); }
    } else if (a === 'share') {
      if (typeof navigator.share !== 'function') { try { await navigator.clipboard.writeText(link); onNote('Link copied', <LinkIcon />); } catch { /* nothing left to try */ } return; }
      try { await navigator.share({ url: link }); } catch { /* cancelled */ }
    } else {
      try { await saveImage(await (await fetch(post.imageUrl)).blob(), `pingo-post-${post.id}.jpg`); onNote('Saved', <Check />); } catch { onNote('Could not save it', <Download />); }
    }
  };

  const ACTS: ['story' | 'cf' | 'copy' | 'share' | 'dl', string, React.ReactNode][] = [
    ['story', 'Add to story', <CirclePlus key="s" />],
    ['cf', 'Close friends', <Star key="c" />],
    ['copy', 'Copy link', <LinkIcon key="l" />],
    ['share', 'Share to…', <Share key="h" />],
    ['dl', 'Download', <Download key="d" />],
  ];

  return (
    <div className="fixed inset-0 z-[1010]" role="dialog" aria-modal="true" aria-label="Share">
      <div
        className="absolute inset-0 bg-black/45 transition-opacity duration-[250ms]"
        style={{ opacity: closing ? 0 : 1, animation: 'sps-fade .25s' }}
        onClick={() => close()}
      />
      <div
        ref={sheet}
        className="absolute inset-x-0 bottom-0 flex max-h-[86%] flex-col rounded-t-[18px] bg-white text-[#111] transition-transform duration-[340ms] ease-[cubic-bezier(.2,.8,.2,1)]"
        style={{ transform: closing ? 'translateY(105%)' : undefined, animation: 'sps-up .34s cubic-bezier(.2,.8,.2,1)' }}
      >
        <style>{'@keyframes sps-up { from { transform: translateY(105%) } } @keyframes sps-fade { from { opacity: 0 } }'}</style>
        {/* drag the grab handle down to dismiss, as every iOS sheet does */}
        <div
          className="relative mx-auto mt-2 mb-2.5 h-1 w-[38px] shrink-0 touch-none rounded-sm bg-[#c7c7cc] before:absolute before:inset-x-0 before:top-0 before:h-6 before:content-['']"
          onPointerDown={(e) => { drag.current = { y: e.clientY, dy: 0 }; e.currentTarget.setPointerCapture(e.pointerId); if (sheet.current) sheet.current.style.transition = 'none'; }}
          onPointerMove={(e) => { const d = drag.current; if (!d || !sheet.current) return; d.dy = Math.max(0, e.clientY - d.y); sheet.current.style.transform = `translateY(${d.dy}px)`; }}
          onPointerUp={() => { const d = drag.current; drag.current = undefined; if (!sheet.current) return; sheet.current.style.transition = ''; sheet.current.style.transform = ''; if (d && d.dy > 90) close(); }}
        />
        <label className="mx-3.5 mb-3 flex h-[38px] shrink-0 items-center gap-2 rounded-[10px] bg-[#efefef] px-3 text-[#8e8e8e]">
          <Search size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-[15px] text-[#111] outline-none placeholder:text-[#8e8e8e]" />
        </label>
        <div className="scrollbar-none min-h-0 overflow-y-auto px-3.5 pb-6">
          <div className="grid grid-cols-4 gap-x-1.5 gap-y-3.5 pt-1 pb-3.5">
            {people.map((c) => (
              <button key={c.id} type="button" data-person={c.id} onClick={() => toggle(c.id)} aria-pressed={picked.has(c.id)} className="flex min-w-0 flex-col items-center gap-1.5 text-[11.5px]">
                {c.avatarUrl
                  ? <img src={c.avatarUrl} alt="" className="size-[62px] rounded-full object-cover" style={picked.has(c.id) ? { boxShadow: '0 0 0 3px #0a84ff' } : undefined} />
                  : <span className="grid size-[62px] place-items-center rounded-full bg-[#efefef] text-[22px] font-bold text-[#555]" style={picked.has(c.id) ? { boxShadow: '0 0 0 3px #0a84ff' } : undefined}>{c.title[0]}</span>}
                <span className="w-full truncate text-center">{c.title}</span>
              </button>
            ))}
          </div>
          {people.length === 0 && <p className="py-6 text-center text-[14px] text-[#8e8e8e]">{q ? 'Nobody by that name' : 'No chats yet'}</p>}
        </div>
        <div className="scrollbar-none flex shrink-0 gap-3.5 overflow-x-auto border-t border-[#efefef] px-3.5 pt-3 pb-[max(18px,env(safe-area-inset-bottom))]">
          {picked.size ? (
            <>
              <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write a message…" className="h-11 min-w-0 flex-1 rounded-[10px] bg-[#efefef] px-3 text-[15px] outline-none" />
              <button type="button" data-a="send" onClick={send} className="h-11 shrink-0 rounded-[10px] bg-media-accent px-[18px] font-bold text-on-media-accent">Send</button>
            </>
          ) : ACTS.map(([a, label, icon]) => (
            <button key={a} type="button" data-a={a} onClick={() => void act(a)} className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center text-[11.5px] leading-tight">
              <span className={a === 'cf' ? 'grid size-[52px] place-items-center rounded-full bg-close-friends text-white' : 'grid size-[52px] place-items-center rounded-full bg-[#efefef]'}>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
