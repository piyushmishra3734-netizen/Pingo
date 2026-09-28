import { useChat, type Story, type StoryViewer as Watcher } from '@pingo/core';
import {
  BellOff, Camera, ChartNoAxesColumn, CircleUserRound, CirclePlus, Download, Eye, Flag, Heart, Link as LinkIcon,
  MoreVertical, Send, SlidersHorizontal, Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { publicAppUrl } from '../../lib/public-origin.js';
import { MenuGroup, MenuRow, PersonRow, SendButton, SheetBody, SheetSearch, StorySheet, useSheetClose } from './StorySheet.js';

/*
 * The viewer's sheets, as the stories sample draws them: dark, a grab handle,
 * plain rows. Each action closes its sheet first, then acts.
 */

/** ⋯ on somebody else's story. */
export function OtherMenu({ onClose, onReport, onMute, onAbout, onCopy }: {
  onClose: () => void; onReport: () => void; onMute: () => void; onAbout: () => void; onCopy: () => void;
}) {
  return (
    <StorySheet onClose={onClose}>
      <Rows rows={[
        [<Flag key="r" />, 'Report', onReport, true],
        [<BellOff key="m" />, 'Mute', onMute],
        [<CircleUserRound key="a" />, 'About this account', onAbout],
        [<LinkIcon key="c" />, 'Copy link', onCopy],
      ]} />
    </StorySheet>
  );
}

/** ⋮ on your own story. */
export function MyMenu({ onClose, onDelete, onSave, onHighlight, onSend, onSettings }: {
  onClose: () => void; onDelete: () => void; onSave: () => void; onHighlight: () => void; onSend: () => void; onSettings: () => void;
}) {
  return (
    <StorySheet onClose={onClose}>
      <Rows rows={[
        [<Trash2 key="d" />, 'Delete', onDelete, true],
        [<Download key="s" />, 'Save', onSave],
        [<CirclePlus key="h" />, 'Highlight', onHighlight],
        [<Send key="t" />, 'Send to…', onSend],
        [<SlidersHorizontal key="g" />, 'Story settings', onSettings],
      ]} />
    </StorySheet>
  );
}

function Rows({ rows }: { rows: [React.ReactNode, string, () => void, boolean?][] }) {
  const close = useSheetClose();
  return (
    <SheetBody className="pt-1">
      <MenuGroup>
        {rows.map(([icon, label, act, danger]) => (
          <MenuRow key={label} icon={icon} label={label} {...(danger ? { danger } : {})} onClick={() => { close(); window.setTimeout(act, 260); }} />
        ))}
      </MenuGroup>
    </SheetBody>
  );
}

/**
 * Send to: your chats, each with its own Send. What goes is a link to the
 * author's profile - a story is not copied into a chat. A story that went to
 * close friends only is not yours to pass on, so the sheet says that instead.
 */
export function SendStorySheet({ story, onClose }: { story: Story; onClose: () => void }) {
  const { conversations, service } = useChat();
  const [q, setQ] = useState('');
  const [sent, setSent] = useState<Set<string>>(new Set());
  const list = useMemo(() => conversations
    .filter((c) => (c.kind === 'direct' || c.kind === 'group') && !c.archived)
    .filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase())), [conversations, q]);
  const locked = story.audience === 'close' || story.audience === 'custom';
  const send = (id: string) => {
    setSent((s) => new Set(s).add(id));
    void service.sendMessage({ conversationId: id, body: `${story.authorName}'s story - ${publicAppUrl(`/profile/${story.authorUsername}`)}` })
      .catch(() => setSent((s) => { const n = new Set(s); n.delete(id); return n; }));
  };
  return (
    <StorySheet title="Send to" onClose={onClose}>
      {locked ? (
        <p className="px-5 pb-8 text-center text-[13.5px] text-white/55">This story went to close friends, so it can't be sent on.</p>
      ) : (
        <>
          <SheetSearch value={q} onChange={setQ} />
          <SheetBody>
            {list.map((c) => (
              <PersonRow key={c.id} name={c.title} {...(c.avatarUrl ? { avatar: c.avatarUrl } : {})} sub={c.kind === 'group' ? 'Group' : ''}
                end={<SendButton sent={sent.has(c.id)} onClick={() => send(c.id)} />} />
            ))}
          </SheetBody>
        </>
      )}
    </StorySheet>
  );
}

/**
 * Activity on your own story: the stories along the top, what can be done to
 * this one, and who watched it - a heart on the ones who liked it.
 */
export function ActivitySheet({ stories, current, watchers, onPick, onCamera, onInsights, onSend, onSave, onDelete, onMessage, onClose }: {
  stories: Story[]; current: number; watchers: Watcher[];
  onPick: (i: number) => void; onCamera: () => void; onInsights: () => void; onSend: () => void; onSave: () => void; onDelete: () => void;
  onMessage: (w: Watcher) => void; onClose: () => void;
}) {
  const likes = watchers.filter((w) => w.liked).length;
  return (
    <StorySheet onClose={onClose}>
      <ActivityBody {...{ stories, current, watchers, likes, onPick, onCamera, onInsights, onSend, onSave, onDelete, onMessage }} />
    </StorySheet>
  );
}

function ActivityBody({ stories, current, watchers, likes, onPick, onCamera, onInsights, onSend, onSave, onDelete, onMessage }: {
  stories: Story[]; current: number; watchers: Watcher[]; likes: number;
  onPick: (i: number) => void; onCamera: () => void; onInsights: () => void; onSend: () => void; onSave: () => void; onDelete: () => void; onMessage: (w: Watcher) => void;
}) {
  const close = useSheetClose();
  const then = (f: () => void) => () => { close(); window.setTimeout(f, 260); };
  const icon = 'grid size-10 place-items-center [&>svg]:size-5';
  return (
    <>
      <div className="scrollbar-none flex shrink-0 items-center justify-center gap-2 overflow-x-auto pt-1.5 pb-3">
        {stories.map((s, i) => (
          <button key={s.id} type="button" onClick={then(() => onPick(i))} className="shrink-0">
            {s.kind === 'video'
              ? <video src={s.mediaUrl} muted playsInline className={thumb(i === current)} />
              : <img src={s.mediaUrl} alt="" className={thumb(i === current)} />}
          </button>
        ))}
        <button type="button" aria-label="New story" onClick={then(onCamera)} className="grid h-[100px] w-14 shrink-0 place-items-center rounded-[8px] bg-media-field [&>svg]:size-[22px]"><Camera /></button>
      </div>
      <div className="flex shrink-0 items-center gap-1 border-y border-media-field px-3.5 py-2">
        <span className="flex flex-1 items-center gap-1.5 text-[14px] font-bold"><Eye size={14} />{watchers.length}</span>
        <button type="button" aria-label="Insights" onClick={onInsights} className={icon}><ChartNoAxesColumn /></button>
        <button type="button" aria-label="Share" onClick={then(onSend)} className={icon}><Send /></button>
        <button type="button" aria-label="Save" onClick={onSave} className={icon}><Download /></button>
        <button type="button" aria-label="Delete" onClick={then(onDelete)} className={icon}><Trash2 /></button>
      </div>
      <SheetBody>
        <div className="flex justify-between pt-3 pb-1 text-[15px] font-bold"><span>Viewers</span><span className="font-medium text-white/55">{likes} {likes === 1 ? 'like' : 'likes'}</span></div>
        {watchers.map((w) => (
          <PersonRow key={w.userId} name={w.username} sub={w.displayName} subTone="#a1a1a6" {...(w.avatarUrl ? { avatar: w.avatarUrl } : {})}
            badge={w.liked ? <span className="absolute -right-0.5 -bottom-0.5 grid size-[18px] place-items-center rounded-full bg-danger shadow-[0_0_0_2px_#1c1c1e]"><Heart size={10} fill="#fff" stroke="#fff" /></span> : undefined}
            end={<>
              <span className="grid size-[34px] place-items-center [&>svg]:size-5"><MoreVertical /></span>
              <button type="button" aria-label={`Message ${w.username}`} onClick={then(() => onMessage(w))} className="grid size-[34px] place-items-center [&>svg]:size-5"><Send /></button>
            </>} />
        ))}
        {watchers.length === 0 && <p className="py-6 text-center text-[13.5px] text-white/55">No one yet</p>}
      </SheetBody>
    </>
  );
}
const thumb = (cur: boolean) => cur
  ? 'h-[136px] w-[76px] rounded-[8px] object-cover opacity-100 shadow-[0_0_0_2px_#fff] transition-all duration-[250ms]'
  : 'h-[100px] w-14 rounded-[8px] object-cover opacity-60 transition-all duration-[250ms]';
