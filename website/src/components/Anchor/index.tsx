import type {ReactNode} from 'react';
import useBrokenLinks from '@docusaurus/useBrokenLinks';

// An empty deep-link target (<span id>) that Docusaurus's broken-anchor check
// can see. The check only knows anchors registered through collectAnchor()
// (headings, list items, links) and ignores a raw <span id="...">, so every
// link to one is reported as broken even though the id exists in the HTML.
// Rendering the span from here registers it too.
export default function Anchor({id}: {id: string}): ReactNode {
  useBrokenLinks().collectAnchor(id);
  return <span id={id} />;
}
