import MDXComponents from '@theme-original/MDXComponents';
import Anchor from '@site/src/components/Anchor';

// Makes <Anchor id="..." /> available in every doc without an import.
export default {
  ...MDXComponents,
  Anchor,
};
