import type { AiCommand } from '@pingo/core';
import {
  Angry,
  Bookmark,
  Brain,
  CircleHelp,
  FileText,
  Frown,
  Globe,
  ImageIcon,
  Languages,
  Laugh,
  Lightbulb,
  Moon,
  Phone,
  Settings,
  Smile,
  Sparkles,
  SquarePen,
  Target,
} from 'lucide-react';

import type { ComposerCommand } from '../chat/Composer.js';
import type { FlowFace } from './flow/engine.js';

/**
 * Slash commands in PINGO AI's chat.
 *
 * Two kinds. The first six steer the reply (search the web, draw, remember...)
 * and go to the server as `aiCommand`; the rest are faces, played by Pingo
 * Flow on the spot and never sent.
 */

const ICON = { size: 17, strokeWidth: 2, 'aria-hidden': true } as const;

const ASK: { name: AiCommand; hint: string; icon: ComposerCommand['icon']; face: FlowFace }[] = [
  { name: 'search', hint: 'Look it up on the web, with sources', icon: <Globe {...ICON} />, face: 'thinking' },
  { name: 'image', hint: 'Create a picture from your words', icon: <ImageIcon {...ICON} />, face: 'excited' },
  { name: 'remember', hint: 'Save something for later', icon: <Bookmark {...ICON} />, face: 'happy' },
  { name: 'summarize', hint: 'Sum up a file, a photo or this chat', icon: <FileText {...ICON} />, face: 'thinking' },
  { name: 'translate', hint: 'Translate text into another language', icon: <Languages {...ICON} />, face: 'thinking' },
  { name: 'explain', hint: 'Explain it simply, with an example', icon: <Lightbulb {...ICON} />, face: 'thinking' },
];

/** Things the app does itself, at once: no reply needed. */
type AppAction = 'goal' | 'new' | 'call' | 'settings';
const APP: { name: AppAction; hint: string; icon: ComposerCommand['icon'] }[] = [
  { name: 'goal', hint: 'Add a goal, like /goal learn tennis', icon: <Target {...ICON} /> },
  { name: 'new', hint: 'Start a new chat with PINGO AI', icon: <SquarePen {...ICON} /> },
  { name: 'call', hint: 'Call PINGO AI now', icon: <Phone {...ICON} /> },
  { name: 'settings', hint: "Open PINGO AI's settings", icon: <Settings {...ICON} /> },
];

const FACES: { name: FlowFace; hint: string; icon: ComposerCommand['icon'] }[] = [
  { name: 'happy', hint: 'Pingo Flow smiles', icon: <Smile {...ICON} /> },
  { name: 'excited', hint: 'Pingo Flow gets excited', icon: <Laugh {...ICON} /> },
  { name: 'surprised', hint: 'Pingo Flow looks surprised', icon: <Sparkles {...ICON} /> },
  { name: 'thinking', hint: 'Pingo Flow thinks it over', icon: <Brain {...ICON} /> },
  { name: 'confused', hint: 'Pingo Flow is confused', icon: <CircleHelp {...ICON} /> },
  { name: 'sleepy', hint: 'Pingo Flow gets sleepy', icon: <Moon {...ICON} /> },
  { name: 'sad', hint: 'Pingo Flow looks sad', icon: <Frown {...ICON} /> },
  { name: 'angry', hint: 'Pingo Flow gets angry', icon: <Angry {...ICON} /> },
];

export const AI_COMMANDS: ComposerCommand[] = [...ASK, ...APP, ...FACES].map(({ name, hint, icon }) => ({ name, hint, icon }));

export type ParsedCommand =
  | { kind: 'ask'; command: AiCommand; body: string; face: FlowFace }
  | { kind: 'face'; face: FlowFace }
  | { kind: 'app'; action: AppAction; body: string };

/** `/search weather in Pune` → the search command and its text; anything else, undefined. */
export function parseAiCommand(text: string): ParsedCommand | undefined {
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return undefined;
  const name = match[1]!.toLowerCase();
  const body = (match[2] ?? '').trim();
  const ask = ASK.find((c) => c.name === name);
  if (ask) return { kind: 'ask', command: ask.name, body, face: ask.face };
  const app = APP.find((c) => c.name === name);
  if (app) return { kind: 'app', action: app.name, body };
  const face = FACES.find((c) => c.name === name);
  if (face && !body) return { kind: 'face', face: face.name };
  return undefined;
}
