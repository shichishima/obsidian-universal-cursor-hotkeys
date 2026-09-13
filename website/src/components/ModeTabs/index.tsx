import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';

import styles from './styles.module.css';

export type Mode = 'for-everyone' | 'vim-mode' | 'macos-emacs-style';

const TABS: {mode: Mode; label: string; className: string}[] = [
  {mode: 'for-everyone', label: 'For everyone', className: styles.tabBtnGeneral},
  {mode: 'vim-mode', label: 'Vim mode', className: styles.tabBtnVim},
  {mode: 'macos-emacs-style', label: 'macOS (Emacs) style', className: styles.tabBtnEmacs},
];

// Mirrors the plugin's own Settings screen segmented control (see
// styles.module.css's own header comment for the exact CSS this ports
// from) — lets a reader jump between the three mode sections from
// anywhere within one, the same way the in-app tab bar stays reachable
// while scrolling through a tab's own settings.
//
// `current` is optional: on the Overview page (not itself any one mode),
// the bar renders with no tab highlighted, just a plain jump-to-a-mode
// widget. `sticky` defaults to true (the 12 mode pages' own usage, via the
// swizzled DocItem/Layout); the Overview page's own inline placement below
// its "which one are you?" links passes `sticky={false}` — it's fine for
// that copy to scroll away normally there, and it also sidesteps a second
// position:sticky element competing with the mode pages' own for the same
// screen region were a reader to reach it via in-page navigation.
export default function ModeTabs({
  current,
  sticky = true,
}: {
  current?: Mode;
  sticky?: boolean;
}): ReactNode {
  // On the Overview page (current === undefined), none of the three is
  // "selected", but muting all three text labels the same way an inactive
  // tab is muted elsewhere reads as "these are lesser options" — wrong for
  // a page whose whole point is presenting all three as equally valid.
  // Give every label the active tab's own text color here, without also
  // giving any of them the active pill/background (nothing really is
  // selected on this page).
  const noSelection = current === undefined;

  const bar = (
    <div className={styles.tabBar}>
      {TABS.map(({mode, label, className}) => (
        <Link
          key={mode}
          to={`/${mode}`}
          className={clsx(styles.tabBtn, className, {
            [styles.tabBtnActive]: mode === current,
            [styles.tabBtnBrightText]: noSelection,
          })}>
          {label}
        </Link>
      ))}
    </div>
  );

  if (!sticky) {
    return <div className={styles.tabBarStatic}>{bar}</div>;
  }

  return <div className={styles.tabBarSticky}>{bar}</div>;
}
