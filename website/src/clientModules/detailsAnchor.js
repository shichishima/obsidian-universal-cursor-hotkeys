// Auto-expand a collapsed <details> block when navigating to a #fragment
// pointing at an id inside its (normally hidden) body content — or at an
// empty marker <span id="..."></span> placed immediately BEFORE the
// <details> (the layout command-details.md actually uses; MDX renders it as
// a bare sibling of <details>, not wrapped in a <p>) — and scroll
// to it accounting for this site's two stacked sticky headers (Docusaurus's
// own .navbar, plus this project's ModeTabs bar pinned right below it at
// `top: var(--ifm-navbar-height)` — see src/components/ModeTabs/styles.module.css).
// Plain scrollIntoView() doesn't know about either, so the target lands
// hidden behind them (confirmed live 2026-09-20, screenshot).
//
// Docusaurus's classic theme also doesn't render raw markdown <details> as
// a plain native element — it wraps it in its own React component that
// tracks open/closed via a `data-collapsed` attribute, toggled by an
// onClick handler on <summary>. Confirmed live (2026-09-20, via logging):
// directly setting the native `.open` property DOES take effect (stays
// `true` even 100ms later) but has NO visible effect, since the theme's
// own CSS/animation gates on `data-collapsed`, not the native open state —
// the two are only kept in sync when toggled via a real click on
// <summary>. So: simulate that click instead of touching `.open` directly.
import ExecutionEnvironment from '@docusaurus/ExecutionEnvironment';

function stickyHeaderHeight() {
  const navbar = document.querySelector('.navbar');
  const navbarHeight = navbar ? navbar.getBoundingClientRect().height : 0;
  // CSS Modules hash class names but keep the source name as a prefix
  // (confirmed live: "tabBarSticky" -> "tabBarSticky_XXXX"), so a substring
  // match is stable across builds without importing the CSS module here.
  let tabBarHeight = 0;
  document.querySelectorAll('[class*="tabBarSticky"]').forEach((el) => {
    tabBarHeight = Math.max(tabBarHeight, el.getBoundingClientRect().height);
  });
  return navbarHeight + tabBarHeight;
}

function openTargetDetails(hash) {
  if (!hash) return;
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  const target = document.getElementById(id);
  if (!target) return;
  // Enclosing <details> (id inside its body), or else the <details> that
  // directly follows a marker span (nextElementSibling skips the "\n" text
  // node between them).
  let details = target.closest('details');
  if (!details && target.nextElementSibling?.tagName === 'DETAILS') {
    details = target.nextElementSibling;
  }
  if (details) {
    const isCollapsed = details.dataset.collapsed === 'true' || !details.open;
    if (isCollapsed) {
      const summary = details.querySelector('summary');
      if (summary) summary.click();
    }
  }
  requestAnimationFrame(() => {
    // Scroll to the <details> element itself (so its own <summary> heading
    // is visible), not the inner marker span used to find it — scrolling
    // to the span would push the summary/heading off-screen above it.
    const scrollTarget = details || target;
    const offset = stickyHeaderHeight();
    const y = scrollTarget.getBoundingClientRect().top + window.scrollY - offset - 16;
    window.scrollTo({top: Math.max(0, y), behavior: 'auto'});
  });
}

export function onRouteDidUpdate({location}) {
  if (!ExecutionEnvironment.canUseDOM) return;
  setTimeout(() => openTargetDetails(location.hash), 0);
}

if (ExecutionEnvironment.canUseDOM) {
  window.addEventListener('load', () => openTargetDetails(window.location.hash));
}
