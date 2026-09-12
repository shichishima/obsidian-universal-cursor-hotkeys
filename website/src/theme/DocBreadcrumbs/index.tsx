/**
 * Swizzled from @docusaurus/theme-classic's DocBreadcrumbs (index.tsx).
 *
 * The only change from the original: when the current page IS the site's
 * own home page (the Overview doc, which lives at "/"), the trailing
 * breadcrumb items are suppressed so only the 🏠 Home crumb renders —
 * otherwise the default behavior always shows "🏠 > Overview", a second
 * crumb pointing at the exact same page the Home icon already links to.
 * Every other page's breadcrumb trail (Home icon + its own path) is
 * unaffected.
 */

import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {useSidebarBreadcrumbs} from '@docusaurus/plugin-content-docs/client';
import {useHomePageRoute, isSamePath} from '@docusaurus/theme-common/internal';
import {useLocation} from '@docusaurus/router';
import Link from '@docusaurus/Link';
import {translate} from '@docusaurus/Translate';
import HomeBreadcrumbItem from '@theme/DocBreadcrumbs/Items/Home';
import DocBreadcrumbsStructuredData from '@theme/DocBreadcrumbs/StructuredData';

import styles from './styles.module.css';

// TODO move to design system folder
function BreadcrumbsItemLink({
  children,
  href,
  isLast,
}: {
  children: ReactNode;
  href: string | undefined;
  isLast: boolean;
}): ReactNode {
  const className = 'breadcrumbs__link';
  if (isLast) {
    return <span className={className}>{children}</span>;
  }
  return href ? (
    <Link className={className} href={href}>
      <span>{children}</span>
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

// TODO move to design system folder
function BreadcrumbsItem({
  children,
  active,
}: {
  children: ReactNode;
  active?: boolean;
}): ReactNode {
  return (
    <li
      className={clsx('breadcrumbs__item', {
        'breadcrumbs__item--active': active,
      })}>
      {children}
    </li>
  );
}

export default function DocBreadcrumbs(): ReactNode {
  const breadcrumbs = useSidebarBreadcrumbs();
  const homePageRoute = useHomePageRoute();
  const location = useLocation();
  // homePageRoute.path is typed string | string[] (react-router-config
  // allows an array of matched paths) — Docusaurus never actually
  // generates a multi-path route, so this is always a single string in
  // practice, but isSamePath only accepts a plain string.
  const homePagePath =
    typeof homePageRoute?.path === 'string' ? homePageRoute.path : undefined;
  const isOnHomePage = Boolean(
    homePagePath && isSamePath(location.pathname, homePagePath),
  );

  if (!breadcrumbs) {
    return null;
  }

  return (
    <>
      <DocBreadcrumbsStructuredData breadcrumbs={breadcrumbs} />
      <nav
        className={clsx(
          ThemeClassNames.docs.docBreadcrumbs,
          styles.breadcrumbsContainer,
        )}
        aria-label={translate({
          id: 'theme.docs.breadcrumbs.navAriaLabel',
          message: 'Breadcrumbs',
          description: 'The ARIA label for the breadcrumbs',
        })}>
        <ul className="breadcrumbs">
          {homePageRoute && <HomeBreadcrumbItem />}
          {!isOnHomePage &&
            breadcrumbs.map((item, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              const href =
                item.type === 'category' && item.linkUnlisted
                  ? undefined
                  : item.href;
              return (
                <BreadcrumbsItem key={idx} active={isLast}>
                  <BreadcrumbsItemLink href={href} isLast={isLast}>
                    {item.label}
                  </BreadcrumbsItemLink>
                </BreadcrumbsItem>
              );
            })}
        </ul>
      </nav>
    </>
  );
}
