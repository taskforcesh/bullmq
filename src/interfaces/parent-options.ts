export type ParentOptions = {
  /**
   * Parent identifier.
   */
  id: string;

  /**
   * It includes the prefix, the namespace separator :, and queue name.
   * @see {@link https://www.gnu.org/software/gawk/manual/html_node/Qualified-Names.html}
   */
  queue: string;
};
