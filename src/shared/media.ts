/** URL for streaming a local file through the privileged media:// protocol. */
export const mediaUrl = (absPath: string) =>
  'media://local' + absPath.split('/').map(encodeURIComponent).join('/')

export const joinPath = (...parts: string[]) =>
  parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
