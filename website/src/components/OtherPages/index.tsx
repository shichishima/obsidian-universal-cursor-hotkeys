import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Translate from '@docusaurus/Translate';
import {
  useDoc,
  useDocById,
  useSidebarBreadcrumbs,
} from '@docusaurus/plugin-content-docs/client';
import type {PropSidebarItemCategory} from '@docusaurus/plugin-content-docs';

import styles from './styles.module.css';

type Entry = {docId: string | undefined; href: string; label: string};

function PageCard({docId, href, label}: Entry): ReactNode {
  const description = useDocById(docId)?.description;
  return (
    <li className={styles.card}>
      <Link className={styles.link} to={href}>
        {label}
      </Link>
      {description && <p className={styles.description}>{description}</p>}
    </li>
  );
}

// Links to the other pages of the mode the current doc belongs to, generated
// from the sidebar tree plus each doc's own `description` frontmatter — so
// there is no hand-written link list to keep in sync per page and locale.
// These docs have no reading order (unlike a tutorial), which is why this
// replaces the sidebar-order prev/next paginator, which chained the modes
// together (e.g. "For everyone" → "Vim mode"). On a mode's own index page the
// list is just the mode's pages (the index is the current doc, so it is left
// out); docs outside a mode (Behavior Options, Changelog) have no siblings to
// show.
export default function OtherPages(): ReactNode {
  const {metadata, frontMatter} = useDoc();
  const mode = (frontMatter as {mode?: string}).mode;
  const breadcrumbs = useSidebarBreadcrumbs();
  if (!mode || !breadcrumbs) {
    return null;
  }
  const overviewId = `${mode}/index`;

  const category = [...breadcrumbs]
    .reverse()
    .find((item): item is PropSidebarItemCategory => item.type === 'category');
  if (!category) {
    return null;
  }

  const entries: Entry[] = [];
  if (category.href && metadata.id !== overviewId) {
    entries.push({docId: overviewId, href: category.href, label: category.label});
  }
  for (const item of category.items) {
    if (item.type === 'link' && item.docId && item.docId !== metadata.id && !item.unlisted) {
      entries.push({docId: item.docId, href: item.href, label: item.label});
    }
  }
  if (entries.length === 0) {
    return null;
  }

  return (
    <nav className={styles.root} aria-labelledby="other-pages-title">
      <h2 id="other-pages-title" className={styles.title}>
        {metadata.id === overviewId ? (
          <Translate
            id="uch.pageList.title"
            description="Heading of the page list on a mode's index page; {mode} is the mode's name"
            values={{mode: category.label}}>
            {'{mode} : Pages'}
          </Translate>
        ) : (
          <Translate
            id="uch.otherPages.title"
            description="Heading of the block that links to the other pages of the same mode; {mode} is the mode's name"
            values={{mode: category.label}}>
            {'{mode} : Other pages'}
          </Translate>
        )}
      </h2>
      <ul className={styles.list}>
        {entries.map((entry) => (
          <PageCard key={entry.href} {...entry} />
        ))}
      </ul>
    </nav>
  );
}
