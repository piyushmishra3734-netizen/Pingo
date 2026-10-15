import { Check, Crown, Sparkles } from 'lucide-react';

import { Card, TopBar } from './pastel.js';

/**
 * Pingo Pro, as it really is: `profiles.is_premium`, granted by the operator.
 * There is no purchase in the app yet, so this page says so instead of
 * offering a button that would take money or pretend to.
 */
export function ProPage({ premium, onBack }: { premium: boolean; onBack: () => void }) {
  const perks = [
    { icon: <Sparkles size={22} />, title: 'Pro avatars', sub: 'Wizard, Explorer and At work for Pingo' },
    { icon: <Crown size={22} />, title: 'GIF covers', sub: 'An animated cover on your profile' },
  ];
  return (
    <>
      <TopBar title="Pingo Pro" onBack={onBack} />
      <div className="pp-pad flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-2">
        <div className="pp-card mt-2 flex flex-col items-center px-5 py-6 text-center" style={{ background: 'var(--pp-pro)' }}>
          <Crown size={44} className="fill-[var(--pp-gold)] text-[var(--pp-gold)]" aria-hidden />
          <h2 className="mt-2 text-[24px] font-extrabold">{premium ? 'Pro is on' : 'Pingo Pro'}</h2>
          <p className="mt-1 max-w-[18rem] text-[15px] leading-snug text-[var(--pp-sub)]">
            {premium ? 'Everything below is unlocked on your account.' : "Pro can't be bought in the app yet. When it can, it will be right here."}
          </p>
        </div>
        <Card className="mt-3">
          <ul className="divide-y divide-[var(--pp-line)]">
            {perks.map((p) => (
              <li key={p.title} className="flex items-center gap-3.5 px-4 py-3.5">
                <span className="text-[var(--pp-accent)]">{p.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold">{p.title}</span>
                  <span className="block text-[13.5px] text-[var(--pp-sub)]">{p.sub}</span>
                </span>
                {premium && <Check size={20} strokeWidth={2.6} className="text-[var(--pp-online)]" aria-label="Included" />}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
