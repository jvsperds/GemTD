import * as db from '../persist';
import { QUESTS } from '../quests';
import { DEFAULT_HERO, HEROES } from '../sim/heroes';
import { PASSIVES, SKILLS, bringLimit, goldOf, passiveTip, skillTip } from '../sim/skills';
import { $ } from './dom';

/** Quests tab: every quest, done ones ticked. */
export async function drawQuests() {
  const done = (await db.get('hero')).quests ?? [];
  $('questlist').replaceChildren(
    ...QUESTS.map((q) => {
      const li = document.createElement('li');
      li.className = done.includes(q.id) ? 'done' : '';
      li.textContent = `${done.includes(q.id) ? '✓' : '○'} ${q.name}: ${q.tip} (${q.shells} 🐚)`;
      return li;
    }),
  );
}
let inspectedHero: string | undefined;
let saving = false;
let renderVersion = 0;

/** Progression has separate inspect, purchase, and equip actions. */
export async function drawShop() {
  const version = ++renderVersion;
  const hero = await db.get('hero');
  if (version !== renderVersion) return;
  const owned = new Set([DEFAULT_HERO, ...(hero.heroes ?? [])]);
  const picked = owned.has(hero.hero ?? '') ? hero.hero! : DEFAULT_HERO;
  const limit = bringLimit(picked);
  const bring = (hero.bring ?? []).filter((id) => hero.skills[id]).slice(0, limit);
  inspectedHero ??= picked;
  const save = async (change: () => void, focusId: string) => {
    if (saving) return;
    saving = true;
    let error = '';
    try {
      change();
      await db.set('hero', { ...hero, bring });
    } catch {
      error = 'Could not save your loadout. Please try again.';
    } finally {
      saving = false;
    }
    await drawShop();
    $('progressionstatus').textContent = error;
    const target = $<HTMLButtonElement>(focusId);
    if (target && !target.disabled) target.focus({ preventScroll: true });
    else $('equipped').focus({ preventScroll: true });
  };
  $('shells').textContent = String(hero.shells);
  const h = HEROES[picked];
  const skill = (id: string) => SKILLS[id] ?? PASSIVES[id];
  $('loadout').textContent =
    `${h.icon} ${h.name} · ` +
    (bring.map((id) => `${skill(id).icon} ${skill(id).name}`).join(', ') || 'no skills');
  $('playloadout').textContent = $('loadout').textContent;
  $('bringing').textContent = `${bring.length} / ${limit} slots`;
  $('equipped').replaceChildren(
    ...Array.from({ length: limit }, (_, index) => {
      const id = bring[index];
      if (!id) {
        const empty = document.createElement('span');
        empty.className = 'loadout-empty';
        empty.textContent = '+';
        empty.setAttribute('aria-label', 'Empty skill slot');
        return empty;
      }
      const button = document.createElement('button');
      button.id = `slot-${id}`;
      button.className = 'loadout-slot';
      button.innerHTML =
        '<span aria-hidden="true"></span><small></small><span class="slot-remove" aria-hidden="true">×</span>';
      button.children[0].textContent = skill(id).icon;
      button.children[1].textContent = skill(id).name;
      button.setAttribute('aria-label', `Remove ${skill(id).name} from loadout`);
      button.title = `Remove ${skill(id).name}`;
      button.onclick = () => void save(() => bring.splice(bring.indexOf(id), 1), `equip-${id}`);
      return button;
    }),
  );
  $('herolist').replaceChildren(
    ...Object.entries(HEROES).map(([id, definition]) => {
      const button = document.createElement('button');
      button.id = `hero-${id}`;
      button.className = 'hero-choice' + (id === inspectedHero ? ' inspected' : '');
      button.setAttribute('aria-pressed', String(id === inspectedHero));
      button.setAttribute('aria-label', `Inspect ${definition.name}`);
      button.innerHTML =
        '<span class="hero-glyph" aria-hidden="true"></span><b></b><small></small>';
      button.children[0].textContent = definition.icon;
      button.children[1].textContent = definition.name;
      button.children[2].textContent =
        id === picked ? '✓ Selected' : owned.has(id) ? 'Owned' : `${definition.shells} 🐚`;
      button.onclick = () => {
        inspectedHero = id;
        void drawShop().then(() => {
          if (inspectedHero === id && !$('pane-hero').hidden)
            $(`hero-${id}`).focus({ preventScroll: true });
        });
      };
      return button;
    }),
  );
  const previewId = inspectedHero!;
  const preview = HEROES[previewId];
  const have = owned.has(previewId);
  $('herodetailicon').textContent = preview.icon;
  $('herodetailname').textContent = preview.name;
  $('herodetailtitle').textContent = preview.title;
  $('herodetailtip').textContent = preview.tip;
  $('herodetailmeta').textContent =
    `${preview.rarity} · ${have ? 'Unlocked' : 'Locked'} · ${bringLimit(previewId)} skill slots`;
  const select = $<HTMLButtonElement>('selecthero');
  select.textContent =
    previewId === picked
      ? 'Selected for next run'
      : have
        ? 'Select hero'
        : `Unlock & select · ${preview.shells} 🐚`;
  select.disabled = previewId === picked || (!have && hero.shells < preview.shells);
  $('heroafford').textContent =
    !have && hero.shells < preview.shells
      ? `${preview.shells - hero.shells} more shells needed`
      : '';
  select.onclick = () =>
    void save(() => {
      if (!have) {
        hero.shells -= preview.shells;
        hero.heroes = [...(hero.heroes ?? []), previewId];
      }
      hero.hero = previewId;
      bring.splice(bringLimit(previewId));
    }, `hero-${previewId}`);

  const shopItem = (
    id: string,
    definition: { icon: string; name: string; shells: number[] },
    info: (level: number) => string,
  ) => {
    const level = hero.skills[id] ?? 0;
    const price = definition.shells[level];
    const item = document.createElement('article');
    item.className = 'skill-row';
    item.dataset.skill = id;
    const glyph = document.createElement('span');
    glyph.className = 'skill-glyph';
    glyph.textContent = definition.icon;
    glyph.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    copy.className = 'skill-copy';
    const name = document.createElement('h4');
    name.textContent = definition.name;
    const rank = document.createElement('span');
    rank.className = 'skill-rank';
    rank.textContent = level ? `Level ${level} / ${definition.shells.length}` : 'Not unlocked';
    name.append(rank);
    const tip = document.createElement('p');
    tip.textContent = info(Math.max(1, level));
    copy.append(name, tip);
    if (level && price !== undefined) {
      const next = document.createElement('small');
      next.textContent = `Next: ${info(level + 1)}`;
      copy.append(next);
    }
    const actions = document.createElement('div');
    actions.className = 'skill-actions';
    const buy = document.createElement('button');
    buy.id = `buy-${id}`;
    buy.textContent =
      price === undefined ? 'Max level' : `${level ? 'Upgrade' : 'Unlock'} · ${price} 🐚`;
    buy.setAttribute(
      'aria-label',
      `${level ? 'Upgrade' : 'Unlock'} ${definition.name}${price === undefined ? ', max level' : ` for ${price} shells`}`,
    );
    buy.disabled = price === undefined || hero.shells < price;
    buy.onclick = () =>
      void save(() => {
        hero.shells -= price;
        hero.skills = { ...hero.skills, [id]: level + 1 };
        if (!level && bring.length < limit) bring.push(id);
      }, `buy-${id}`);
    actions.append(buy);
    if (level) {
      const on = bring.includes(id);
      const equip = document.createElement('button');
      equip.id = `equip-${id}`;
      equip.className = 'equip-skill' + (on ? ' equipped' : '');
      equip.textContent = on ? '✓ Equipped' : 'Equip';
      equip.setAttribute('aria-label', `${on ? 'Unequip' : 'Equip'} ${definition.name}`);
      equip.setAttribute('aria-pressed', String(on));
      equip.disabled = !on && bring.length >= limit;
      equip.title = equip.disabled ? 'All slots are full. Remove a skill first.' : '';
      equip.onclick = () =>
        void save(() => {
          if (on) bring.splice(bring.indexOf(id), 1);
          else bring.push(id);
        }, `equip-${id}`);
      actions.append(equip);
    }
    item.append(glyph, copy, actions);
    return item;
  };
  $('shop').replaceChildren(
    ...Object.entries(SKILLS).map(([id, definition]) =>
      shopItem(
        id,
        definition,
        (level) => `${skillTip(id, level)} · ${goldOf(id, level)}g per cast`,
      ),
    ),
  );
  $('passives').replaceChildren(
    ...Object.entries(PASSIVES).map(([id, definition]) =>
      shopItem(id, definition, (level) => passiveTip(id, level)),
    ),
  );
}
