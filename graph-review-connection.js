let connection = null;

export function configureGraphReviewConnection({
  getDb,
  getSession
}) {
  if (
    typeof getDb !== 'function' ||
    typeof getSession !== 'function'
  ) {
    throw new Error(
      'Graph review requires database and session getters.'
    );
  }

  connection = {
    getDb,
    getSession
  };
}

export function resolveGraphReviewOptions(options = {}) {
  // PDF preparation does not need a discussion connection.
  if (options.exportMode) {
    return options;
  }

  return {
    ...options,

    getDb:
      typeof options.getDb === 'function'
        ? options.getDb
        : connection?.getDb,

    getSession:
      typeof options.getSession === 'function'
        ? options.getSession
        : connection?.getSession
  };
}
